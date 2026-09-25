import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AiController } from 'src/ai/ai.controller';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { BrokerSyncController } from 'src/broker-sync/broker-sync.controller';
import { jwtSecret } from 'src/env';
import { FiscalController } from 'src/fiscal/fiscal.controller';
import { InvestmentPolicyController } from 'src/investment-policy/investment-policy.controller';
import { PortfolioController } from 'src/portfolio/portfolio.controller';
import { ReportsController } from 'src/reports/reports.controller';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';
import {
	FREE_ACCESS_LEVEL,
	PlanAccess,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	USER_PLAN_RESOLVER,
} from 'src/subscription/application/user-plan.types';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { PlanCapabilityGuard } from './plan-capability.guard';
import {
	PLAN_FREE,
	PlanFree,
	REQUIRED_CAPABILITY_KEY,
	RequiresCapability,
} from './requires-capability.decorator';

/**
 * Integração do gate de plano (TRA-193) — duas partes.
 *
 * 1. HTTP de verdade com os DOIS guards globais registrados como no
 *    `app.module.ts`. Lição do 2FA: spec que monta só o controller testa um
 *    mundo sem guard global, e o que quebra em produção passa verde.
 *
 * 2. Contrato das rotas reais: qual capability cada rota paga exige. Se
 *    alguém remover um `@RequiresCapability` (ou trocar a capability), a
 *    feature paga não fica aberta em silêncio — este teste quebra.
 */
describe('Gate de plano — integração', () => {
	describe('pipeline HTTP com guards globais', () => {
		@RequiresCapability('fiscal.darf')
		@Controller('probe')
		class ProbeController {
			@Get('darf')
			darf() {
				return { ok: 'darf' };
			}

			@RequiresCapability('risk.analytics')
			@Get('risk')
			risk() {
				return { ok: 'risk' };
			}

			@PlanFree()
			@Get('free')
			free() {
				return { ok: 'free' };
			}
		}

		let app: INestApplication;
		let jwt: JwtService;
		const planByUser = new Map<string, PlanAccess>();
		const resolver = {
			resolve: jest.fn(),
			resolveWithCapabilities: jest.fn(
				async (userId: string) =>
					planByUser.get(userId) ?? {
						tier: FREE_ACCESS_LEVEL,
						capabilities: [],
					}
			),
		};

		const bearer = (userId: string, type = 'access') =>
			`Bearer ${jwt.sign({ userId, type, role: 'user' })}`;

		beforeAll(async () => {
			planByUser.set('free-user', {
				tier: FREE_ACCESS_LEVEL,
				capabilities: [],
			});
			planByUser.set('pro-user', { tier: PRO_ACCESS_LEVEL, capabilities: [] });
			planByUser.set('wealth-user', {
				tier: PREMIUM_ACCESS_LEVEL,
				capabilities: [],
			});

			const moduleRef = await Test.createTestingModule({
				imports: [JwtModule.register({ secret: jwtSecret })],
				controllers: [ProbeController],
				providers: [
					// Mesma ordem do app.module.ts.
					{ provide: APP_GUARD, useClass: JwtAuthGuard },
					{ provide: APP_GUARD, useClass: PlanCapabilityGuard },
					{ provide: USER_PLAN_RESOLVER, useValue: resolver },
					{
						provide: TokenBlacklistService,
						useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
					},
				],
			}).compile();

			app = moduleRef.createNestApplication();
			await app.init();
			jwt = moduleRef.get(JwtService);
		});

		afterAll(async () => {
			await app.close();
		});

		beforeEach(() => resolver.resolveWithCapabilities.mockClear());

		it('sem token: 401 do JwtAuthGuard, antes de olhar plano', async () => {
			await request(app.getHttpServer()).get('/probe/darf').expect(401);
			expect(resolver.resolveWithCapabilities).not.toHaveBeenCalled();
		});

		it('refresh token não passa pelo gate de autenticação (401)', async () => {
			await request(app.getHttpServer())
				.get('/probe/darf')
				.set('Authorization', bearer('pro-user', 'refresh'))
				.expect(401);
		});

		it('plano gratuito recebe 403 com o corpo do upsell', async () => {
			const response = await request(app.getHttpServer())
				.get('/probe/darf')
				.set('Authorization', bearer('free-user'))
				.expect(403);

			expect(response.body).toEqual({
				statusCode: 403,
				error: 'PLAN_CAPABILITY_REQUIRED',
				message: 'PLANO_UPGRADE_NECESSARIO',
				capability: 'fiscal.darf',
			});
		});

		it('Pro acessa fiscal.darf (capability herdada da classe)', async () => {
			await request(app.getHttpServer())
				.get('/probe/darf')
				.set('Authorization', bearer('pro-user'))
				.expect(200, { ok: 'darf' });
		});

		it('Pro não acessa risk.analytics (Wealth) — método sobrescreve a classe', async () => {
			await request(app.getHttpServer())
				.get('/probe/risk')
				.set('Authorization', bearer('pro-user'))
				.expect(403);
		});

		it('Wealth acessa risk.analytics', async () => {
			await request(app.getHttpServer())
				.get('/probe/risk')
				.set('Authorization', bearer('wealth-user'))
				.expect(200, { ok: 'risk' });
		});

		it('@PlanFree() libera o gratuito dentro de classe gateada', async () => {
			await request(app.getHttpServer())
				.get('/probe/free')
				.set('Authorization', bearer('free-user'))
				.expect(200, { ok: 'free' });
			expect(resolver.resolveWithCapabilities).not.toHaveBeenCalled();
		});
	});

	describe('contrato das rotas reais', () => {
		const capabilityOf = (target: object, method?: string) => {
			const handler = method ? (target as any).prototype[method] : undefined;
			// Nome de método errado faria o teste passar vazio (metadata
			// undefined = "livre"). Falha alto em vez disso.
			if (method && typeof handler !== 'function') {
				throw new Error(`${(target as any).name}.${method} não existe`);
			}
			return (
				(handler && Reflect.getMetadata(REQUIRED_CAPABILITY_KEY, handler)) ??
				Reflect.getMetadata(REQUIRED_CAPABILITY_KEY, target)
			);
		};

		it.each([
			[BrokerSyncController, 'connect', 'broker.sync'],
			[BrokerSyncController, 'sync', 'broker.sync'],
			[FiscalController, 'getSummary', 'fiscal.darf'],
			[FiscalController, 'previewSale', 'fiscal.darf'],
			[FiscalController, 'getPortfolioReport', 'fiscal.darf'],
			[FiscalController, 'getIrReport', 'fiscal.ir_report'],
			[ReportsController, 'download', 'reports.export'],
			[ReportsController, 'createSchedule', 'reports.export'],
			[ReportsController, 'listSchedules', 'reports.export'],
			[PortfolioController, 'getRiskContribution', 'risk.analytics'],
			[InvestmentPolicyController, undefined, 'policy.investment'],
			[AiController, 'opportunityRadar', 'ai.insights'],
			[RiIntelligenceController, 'summarize', 'ri.ai_summary'],
		] as const)('%p.%s exige %s', (controller, method, capability) => {
			expect(capabilityOf(controller, method)).toBe(capability);
		});

		it.each([
			[BrokerSyncController, 'getConnections'],
			[BrokerSyncController, 'uploadBrokerageNote'],
			[PortfolioController, 'getSummary'],
			[PortfolioController, 'findAll'],
			[AiController, 'chat'],
			[RiIntelligenceController, 'getDocuments'],
			[RiIntelligenceController, 'getMostRelevantDocument'],
		] as const)(
			'%p.%s continua liberada para o plano gratuito',
			(controller, method) => {
				const capability = capabilityOf(controller, method);
				expect(capability === undefined || capability === PLAN_FREE).toBe(true);
			}
		);
	});
});
