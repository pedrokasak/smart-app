import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { StripeService } from 'src/subscription/stripe.service';
import { ManualGrantType } from './constants/admin.constants';

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

	it('persists isFeatured and isComingSoon when provided', async () => {
		const plan = buildPlan({
			isFeatured: false,
			isComingSoon: false,
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		await service.updatePlan('plan_1', {
			isFeatured: true,
			isComingSoon: true,
		} as any);

		expect(plan.isFeatured).toBe(true);
		expect(plan.isComingSoon).toBe(true);
		expect(plan.save).toHaveBeenCalled();
	});

	it('leaves isFeatured and isComingSoon untouched when omitted', async () => {
		const plan = buildPlan({
			isFeatured: true,
			isComingSoon: false,
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		await service.updatePlan('plan_1', {
			description: 'nova descrição',
		} as any);

		expect(plan.isFeatured).toBe(true);
		expect(plan.isComingSoon).toBe(false);
	});

	it('allows clearing isFeatured with an explicit false', async () => {
		const plan = buildPlan({
			isFeatured: true,
			isComingSoon: false,
		});
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		await service.updatePlan('plan_1', { isFeatured: false } as any);

		expect(plan.isFeatured).toBe(false);
	});
});

describe('AdminService — grantSubscriptionByEmail', () => {
	let service: AdminService;
	let mockSubscriptionModel: any;
	let mockUserModel: any;
	let mockUserSubscriptionModel: any;
	let mockManualGrantAuditModel: any;
	let mockStripeService: any;

	beforeEach(async () => {
		mockUserModel = { findOne: jest.fn(), findById: jest.fn() };
		mockSubscriptionModel = { findById: jest.fn() };
		mockUserSubscriptionModel = { findOneAndUpdate: jest.fn() };
		mockManualGrantAuditModel = { create: jest.fn() };
		mockStripeService = {};

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

	function setupHappyPath() {
		mockUserModel.findOne.mockResolvedValue({
			_id: 'user-1',
			email: 'user@example.com',
		});
		mockUserModel.findById.mockResolvedValue({
			_id: 'admin-1',
			email: 'admin@example.com',
		});
		mockSubscriptionModel.findById.mockResolvedValue({
			_id: 'plan-1',
			name: 'Pro',
			isActive: true,
		});
		mockUserSubscriptionModel.findOneAndUpdate.mockResolvedValue({
			_id: 'sub-1',
		});
	}

	it('throws BadRequestException when TRIAL grant is missing trialDurationDays', async () => {
		setupHappyPath();

		await expect(
			service.grantSubscriptionByEmail('admin-1', {
				email: 'user@example.com',
				planId: '507f1f77bcf86cd799439011',
				grantType: ManualGrantType.Trial,
			} as any)
		).rejects.toThrow(BadRequestException);
	});

	it('applies a custom trial duration instead of the fixed 7 days', async () => {
		setupHappyPath();

		await service.grantSubscriptionByEmail('admin-1', {
			email: 'user@example.com',
			planId: '507f1f77bcf86cd799439011',
			grantType: ManualGrantType.Trial,
			trialDurationDays: 14,
		} as any);

		const [, updatePayload] =
			mockUserSubscriptionModel.findOneAndUpdate.mock.calls[0];
		const periodEnd = updatePayload.$set.currentPeriodEnd as Date;
		const periodStart = updatePayload.$set.currentPeriodStart as Date;
		const diffDays =
			(periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000);

		expect(diffDays).toBeCloseTo(14, 5);
		expect(updatePayload.$set.status).toBe('trialing');
	});

	it('persists discountPercent and trialDurationDays on the audit record', async () => {
		setupHappyPath();

		await service.grantSubscriptionByEmail('admin-1', {
			email: 'user@example.com',
			planId: '507f1f77bcf86cd799439011',
			grantType: ManualGrantType.Trial,
			trialDurationDays: 30,
			discountPercent: 25,
		} as any);

		expect(mockManualGrantAuditModel.create).toHaveBeenCalledWith(
			expect.objectContaining({
				trialDurationDays: 30,
				discountPercent: 25,
			})
		);
	});

	it('does not require trialDurationDays for PERMANENT grants', async () => {
		setupHappyPath();

		await expect(
			service.grantSubscriptionByEmail('admin-1', {
				email: 'user@example.com',
				planId: '507f1f77bcf86cd799439011',
				grantType: ManualGrantType.Permanent,
			} as any)
		).resolves.toMatchObject({
			message: 'Concessão manual aplicada com sucesso',
		});
	});
});

describe('AdminService — listManualGrants', () => {
	let service: AdminService;
	let mockManualGrantAuditModel: any;

	beforeEach(async () => {
		mockManualGrantAuditModel = {
			find: jest.fn(),
			countDocuments: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AdminService,
				{ provide: getModelToken('User'), useValue: {} },
				{ provide: getModelToken('Subscription'), useValue: {} },
				{ provide: getModelToken('UserSubscription'), useValue: {} },
				{
					provide: getModelToken('ManualGrantAudit'),
					useValue: mockManualGrantAuditModel,
				},
				{ provide: StripeService, useValue: {} },
			],
		}).compile();

		service = module.get<AdminService>(AdminService);
	});

	it('returns paginated grant history ordered by most recent', async () => {
		const record = {
			_id: 'grant-1',
			userEmail: 'user@example.com',
			plan: { _id: 'plan-1', name: 'Pro' },
			grantType: ManualGrantType.Trial,
			trialDurationDays: 14,
			discountPercent: 10,
			performedByEmail: 'admin@example.com',
			createdAt: new Date('2026-01-01'),
		};

		const query = {
			find: jest.fn().mockReturnThis(),
			sort: jest.fn().mockReturnThis(),
			skip: jest.fn().mockReturnThis(),
			limit: jest.fn().mockReturnThis(),
			populate: jest.fn().mockReturnThis(),
			lean: jest.fn().mockResolvedValue([record]),
		};
		mockManualGrantAuditModel.find.mockReturnValue(query);
		mockManualGrantAuditModel.countDocuments.mockResolvedValue(1);

		const result = await service.listManualGrants({ page: 1, limit: 20 });

		expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
		expect(result.total).toBe(1);
		expect(result.items[0]).toMatchObject({
			id: 'grant-1',
			userEmail: 'user@example.com',
			planName: 'Pro',
			discountPercent: 10,
		});
	});
});
