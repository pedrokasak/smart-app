import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { StripeService } from 'src/subscription/stripe.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

describe('AdminService — updatePlan', () => {
	let service: AdminService;
	let mockSubscriptionModel: any;
	let mockUserModel: any;
	let mockUserSubscriptionModel: any;
	let mockManualGrantAuditModel: any;
	let mockStripeService: any;

	function buildPlan(overrides: Record<string, any> = {}) {
		const plan: any = {
			_id: 'plan_1',
			name: 'Plano Mensal',
			description: 'Descrição',
			price: 49,
			currency: 'brl',
			interval: 'month',
			intervalCount: 1,
			stripeProductId: 'prod_123',
			stripePriceId: 'price_monthly_old',
			annualPrice: undefined,
			annualStripePriceId: undefined,
			isActive: true,
			...overrides,
		};
		plan.save = jest.fn().mockResolvedValue(plan);
		return plan;
	}

	beforeEach(async () => {
		mockSubscriptionModel = { findById: jest.fn() };
		mockUserModel = { findOne: jest.fn() };
		mockUserSubscriptionModel = {};
		mockManualGrantAuditModel = {};
		mockStripeService = {
			updateProduct: jest.fn().mockResolvedValue({}),
			createPrice: jest.fn().mockResolvedValue({ id: 'price_monthly_new' }),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AdminService,
				{ provide: getModelToken('User'), useValue: mockUserModel },
				{
					provide: getModelToken('Subscription'),
					useValue: mockSubscriptionModel,
				},
				{
					provide: getModelToken('UserSubscription'),
					useValue: mockUserSubscriptionModel,
				},
				{
					provide: getModelToken('ManualGrantAudit'),
					useValue: mockManualGrantAuditModel,
				},
				{ provide: StripeService, useValue: mockStripeService },
			],
		}).compile();

		service = module.get<AdminService>(AdminService);
	});

	it('throws NotFoundException when plan does not exist', async () => {
		mockSubscriptionModel.findById.mockResolvedValue(null);
		await expect(
			service.updatePlan('missing', { name: 'X' } as any)
		).rejects.toThrow(NotFoundException);
	});

	it('persists annualPrice and annualStripePriceId from the update payload', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		const result = await service.updatePlan('plan_1', {
			annualPrice: 411.6,
			annualStripePriceId: 'price_annual_new',
		} as any);

		expect(result.annualPrice).toBe(411.6);
		expect(result.annualStripePriceId).toBe('price_annual_new');
		expect(plan.save).toHaveBeenCalled();
	});

	it('keeps existing annual fields untouched when not present in the update payload', async () => {
		const plan = buildPlan({
			annualPrice: 400,
			annualStripePriceId: 'price_annual_existing',
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		const result = await service.updatePlan('plan_1', {
			name: 'Novo nome',
		} as any);

		expect(result.annualPrice).toBe(400);
		expect(result.annualStripePriceId).toBe('price_annual_existing');
	});

	it('logs a warning when a monthly price change leaves an existing annualStripePriceId unexamined', async () => {
		const plan = buildPlan({
			annualPrice: 400,
			annualStripePriceId: 'price_annual_existing',
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		const warnSpy = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.updatePlan('plan_1', { price: 59 } as any);

		expect(mockStripeService.createPrice).toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('annualStripePriceId')
		);
	});

	it('does not warn when the update payload also updates annualStripePriceId alongside a monthly price change', async () => {
		const plan = buildPlan({
			annualPrice: 400,
			annualStripePriceId: 'price_annual_existing',
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		const warnSpy = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.updatePlan('plan_1', {
			price: 59,
			annualStripePriceId: 'price_annual_new',
		} as any);

		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('does not warn when there is no pre-existing annualStripePriceId to desync', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		const warnSpy = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.updatePlan('plan_1', { price: 59 } as any);

		expect(warnSpy).not.toHaveBeenCalled();
	});
});
