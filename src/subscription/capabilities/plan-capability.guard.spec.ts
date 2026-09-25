import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
	FREE_ACCESS_LEVEL,
	PlanAccess,
	PlanCapability,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import {
	PLAN_CAPABILITY_ERROR,
	PLAN_UPGRADE_MESSAGE,
	PlanCapabilityGuard,
} from './plan-capability.guard';
import { PlanFree, RequiresCapability } from './requires-capability.decorator';

/**
 * Unidade do gate declarativo (TRA-193). Os cenários de plano que antes
 * viviam espalhados nos specs de `BrokerSyncService` e `IrReportService`
 * (TRA-189) estão aqui — agora há um lugar só que decide.
 */
describe('PlanCapabilityGuard', () => {
	let resolver: jest.Mocked<UserPlanResolverPort>;
	let guard: PlanCapabilityGuard;

	@RequiresCapability('fiscal.darf')
	class GatedController {
		inherited() {}
		@RequiresCapability('fiscal.ir_report')
		overridden() {}
		@PlanFree()
		free() {}
	}
	class OpenController {
		open() {}
	}

	function contextFor(
		controller: new () => unknown,
		method: string,
		user: unknown = { userId: 'user-1' }
	): ExecutionContext {
		return {
			getHandler: () => (controller.prototype as any)[method],
			getClass: () => controller,
			switchToHttp: () => ({ getRequest: () => ({ user }) }),
		} as unknown as ExecutionContext;
	}

	function plan(access: Partial<PlanAccess>) {
		resolver.resolveWithCapabilities.mockResolvedValue({
			tier: FREE_ACCESS_LEVEL,
			capabilities: [],
			...access,
		});
	}

	function gatedBy(capability: PlanCapability) {
		@RequiresCapability(capability)
		class Gated {
			route() {}
		}
		return Gated;
	}

	beforeEach(() => {
		resolver = {
			resolve: jest.fn(),
			resolveWithCapabilities: jest.fn(),
		};
		guard = new PlanCapabilityGuard(new Reflector(), resolver);
	});

	describe('rotas sem exigência', () => {
		it('libera rota sem decorator e nem consulta o plano', async () => {
			await expect(
				guard.canActivate(contextFor(OpenController, 'open'))
			).resolves.toBe(true);
			expect(resolver.resolveWithCapabilities).not.toHaveBeenCalled();
		});

		it('@PlanFree() sobrescreve a exigência da classe', async () => {
			await expect(
				guard.canActivate(contextFor(GatedController, 'free'))
			).resolves.toBe(true);
			expect(resolver.resolveWithCapabilities).not.toHaveBeenCalled();
		});
	});

	describe('resolução de metadata', () => {
		it('método sem decorator herda a capability da classe', async () => {
			plan({ tier: FREE_ACCESS_LEVEL });
			await expect(
				guard.canActivate(contextFor(GatedController, 'inherited'))
			).rejects.toThrow(ForbiddenException);
			expect(resolver.resolveWithCapabilities).toHaveBeenCalledWith('user-1');
		});

		it('decorator no método sobrescreve o da classe', async () => {
			plan({
				tier: FREE_ACCESS_LEVEL,
				capabilities: ['fiscal.ir_report'],
				capabilitiesKnown: ['fiscal.ir_report', 'fiscal.darf'],
			});
			// ir_report marcado, darf não: se a classe mandasse, negaria.
			await expect(
				guard.canActivate(contextFor(GatedController, 'overridden'))
			).resolves.toBe(true);
		});
	});

	describe('fallback por nível quando o admin nunca configurou capabilities', () => {
		const cases: Array<[PlanCapability, number, boolean]> = [
			['fiscal.darf', FREE_ACCESS_LEVEL, false],
			['fiscal.darf', PRO_ACCESS_LEVEL, false],
			['fiscal.darf', PREMIUM_ACCESS_LEVEL, true],
			['fiscal.ir_report', PRO_ACCESS_LEVEL, true],
			['reports.export', FREE_ACCESS_LEVEL, false],
			['reports.export', PRO_ACCESS_LEVEL, true],
			['broker.sync', FREE_ACCESS_LEVEL, false],
			['broker.sync', PRO_ACCESS_LEVEL, true],
			['risk.analytics', PRO_ACCESS_LEVEL, false],
			['risk.analytics', PREMIUM_ACCESS_LEVEL, true],
			['policy.investment', PRO_ACCESS_LEVEL, false],
			['policy.investment', PREMIUM_ACCESS_LEVEL, true],
			['ri.ai_summary', PRO_ACCESS_LEVEL, false],
			['ri.ai_summary', PREMIUM_ACCESS_LEVEL, true],
			['ai.insights', PRO_ACCESS_LEVEL, false],
			['ai.insights', PREMIUM_ACCESS_LEVEL, true],
		];

		it.each(cases)('%s no nível %i → %s', async (capability, tier, allowed) => {
			plan({ tier });

			const result = guard.canActivate(
				contextFor(gatedBy(capability), 'route')
			);
			if (allowed) await expect(result).resolves.toBe(true);
			else await expect(result).rejects.toThrow(ForbiddenException);
		});
	});

	describe('capabilities configuradas pelo admin', () => {
		const Broker = gatedBy('broker.sync');

		it('nega quando a capability decidida não está na lista, mesmo em plano alto', async () => {
			plan({
				tier: PREMIUM_ACCESS_LEVEL,
				capabilities: ['ai.insights'],
				capabilitiesKnown: ['ai.insights', 'broker.sync'],
			});
			await expect(
				guard.canActivate(contextFor(Broker, 'route'))
			).rejects.toThrow(ForbiddenException);
		});

		it('libera quando marcada explicitamente, mesmo com nível gratuito', async () => {
			plan({
				tier: FREE_ACCESS_LEVEL,
				capabilities: ['broker.sync'],
				capabilitiesKnown: ['broker.sync'],
			});
			await expect(
				guard.canActivate(contextFor(Broker, 'route'))
			).resolves.toBe(true);
		});

		it('capability criada depois da configuração cai no patamar padrão, não em "negado"', async () => {
			// Plano Pro configurado quando `reports.export` ainda não existia.
			plan({
				tier: PRO_ACCESS_LEVEL,
				capabilities: ['broker.sync', 'fiscal.ir_report'],
				capabilitiesKnown: ['broker.sync', 'fiscal.ir_report'],
			});
			await expect(
				guard.canActivate(contextFor(gatedBy('reports.export'), 'route'))
			).resolves.toBe(true);
		});

		it('plano gravado antes de capabilitiesKnown só decide sobre as 4 capabilities originais', async () => {
			// Lista legada sem `reports.export` e sem `capabilitiesKnown`:
			// Pro precisa continuar exportando relatório.
			plan({ tier: PRO_ACCESS_LEVEL, capabilities: ['broker.sync'] });
			await expect(
				guard.canActivate(contextFor(gatedBy('reports.export'), 'route'))
			).resolves.toBe(true);
			await expect(
				guard.canActivate(contextFor(Broker, 'route'))
			).resolves.toBe(true);

			// ...e a lista legada continua mandando nas originais.
			plan({ tier: PRO_ACCESS_LEVEL, capabilities: ['ai.rag'] });
			await expect(
				guard.canActivate(contextFor(Broker, 'route'))
			).rejects.toThrow(ForbiddenException);
		});
	});

	describe('falha fechada', () => {
		const Fiscal = gatedBy('fiscal.darf');

		it('rota gateada sem usuário no request é negada sem consultar plano', async () => {
			await expect(
				guard.canActivate(contextFor(Fiscal, 'route', null))
			).rejects.toThrow(ForbiddenException);
			expect(resolver.resolveWithCapabilities).not.toHaveBeenCalled();
		});

		it('aceita o id em `sub` quando `userId` não existe', async () => {
			plan({ tier: PREMIUM_ACCESS_LEVEL });
			await guard.canActivate(contextFor(Fiscal, 'route', { sub: 'user-9' }));
			expect(resolver.resolveWithCapabilities).toHaveBeenCalledWith('user-9');
		});
	});

	it('403 carrega código estável, capability e a mensagem que o web já reconhece', async () => {
		plan({ tier: FREE_ACCESS_LEVEL });

		const error = await guard
			.canActivate(contextFor(gatedBy('reports.export'), 'route'))
			.catch((e) => e);

		expect(error).toBeInstanceOf(ForbiddenException);
		expect(error.getResponse()).toEqual({
			statusCode: 403,
			error: PLAN_CAPABILITY_ERROR,
			message: PLAN_UPGRADE_MESSAGE,
			capability: 'reports.export',
		});
	});
});
