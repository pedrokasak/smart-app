import { ForbiddenException } from '@nestjs/common';
import { IrReportService } from 'src/fiscal/services/ir-report.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
} from 'src/subscription/application/user-plan.types';

/**
 * TRA-189: `ensurePremiumAccess` gateava por substring no texto de vitrine
 * (`plan.features.includes('premium'|'ir-report'|...)`) e nem considerava
 * `accessLevel` — só o nome do plano. Estes testes travam o comportamento
 * novo: capability explícita manda, e sem ela cai no accessLevel de
 * verdade (não mais o nome).
 */
describe('IrReportService — ensurePremiumAccess (TRA-189)', () => {
	let subscriptionService: { findCurrentSubscriptionByUser: jest.Mock };
	let service: IrReportService;

	function ensureAccess(userId = 'user-1'): Promise<void> {
		return (service as any).ensurePremiumAccess(userId);
	}

	beforeEach(() => {
		subscriptionService = { findCurrentSubscriptionByUser: jest.fn() };
		service = new IrReportService(
			{} as any,
			{} as any,
			{} as any,
			subscriptionService as unknown as SubscriptionService
		);
	});

	it('rejeita quando não há assinatura ativa', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue(null);

		await expect(ensureAccess()).rejects.toThrow(ForbiddenException);
	});

	it('libera por accessLevel quando o plano nunca teve capabilities configurado', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: { name: 'Pro', accessLevel: PRO_ACCESS_LEVEL },
		});

		await expect(ensureAccess()).resolves.toBeUndefined();
	});

	it('rejeita plano Free mesmo com feature de marketing mencionando "premium" no texto', async () => {
		// Antes bastava a palavra aparecer em `features` pra liberar — a
		// vitrine podia dizer "compare com o Premium" e isso já contava.
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: {
				name: 'Essencial',
				accessLevel: FREE_ACCESS_LEVEL,
				features: ['Compare com o plano Premium'],
			},
		});

		await expect(ensureAccess()).rejects.toThrow(ForbiddenException);
	});

	it('rejeita quando o admin configurou capabilities e fiscal.ir_report não está na lista', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: {
				name: 'Wealth',
				accessLevel: PREMIUM_ACCESS_LEVEL,
				capabilities: ['broker.sync'],
			},
		});

		await expect(ensureAccess()).rejects.toThrow(ForbiddenException);
	});

	it('libera quando o admin marcou fiscal.ir_report explicitamente, mesmo com accessLevel baixo', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: {
				name: 'Essencial Fiscal',
				accessLevel: FREE_ACCESS_LEVEL,
				capabilities: ['fiscal.ir_report'],
			},
		});

		await expect(ensureAccess()).resolves.toBeUndefined();
	});

	it('libera por nome do plano quando accessLevel não está configurado (fallback legado)', async () => {
		subscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			plan: { name: 'Plano Pro Legado' },
		});

		await expect(ensureAccess()).resolves.toBeUndefined();
	});
});
