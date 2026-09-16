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

	// TRA-187: banco de produção carregava produto criado em test mode. O
	// `products.update` respondia `resource_missing` e derrubava a edição
	// inteira, sem saída pela interface — o campo não é editável no painel.
	const resourceMissing = () =>
		Object.assign(
			new Error(
				"No such product: 'prod_123'; a similar object exists in test mode, " +
					'but a live mode key was used to make this request.'
			),
			{ code: 'resource_missing' }
		);

	it('reprovisiona o produto quando o ID gravado não existe na conta Stripe', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		mockStripeService.updateProduct.mockRejectedValue(resourceMissing());
		mockStripeService.createProduct = jest
			.fn()
			.mockResolvedValue({ id: 'prod_live_novo' });

		await service.updatePlan('plan_1', { name: 'Plano Renomeado' } as any);

		expect(mockStripeService.createProduct).toHaveBeenCalledWith(
			'Plano Renomeado',
			'Descrição'
		);
		expect(plan.stripeProductId).toBe('prod_live_novo');
		expect(plan.name).toBe('Plano Renomeado');
		expect(plan.save).toHaveBeenCalled();
	});

	it('gera o novo preço no produto reprovisionado', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		mockStripeService.updateProduct.mockRejectedValue(resourceMissing());
		mockStripeService.createProduct = jest
			.fn()
			.mockResolvedValue({ id: 'prod_live_novo' });

		await service.updatePlan('plan_1', { price: 59 } as any);

		expect(mockStripeService.createPrice).toHaveBeenCalledWith(
			'prod_live_novo',
			59,
			'brl',
			'month',
			1
		);
		expect(plan.stripePriceId).toBe('price_monthly_new');
	});

	it('propaga erro do Stripe que não seja produto inexistente', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		mockStripeService.updateProduct.mockRejectedValue(
			new Error('Connection timeout')
		);
		mockStripeService.createProduct = jest.fn();

		await expect(
			service.updatePlan('plan_1', { name: 'Outro nome' } as any)
		).rejects.toThrow('Connection timeout');
		expect(mockStripeService.createProduct).not.toHaveBeenCalled();
		expect(plan.save).not.toHaveBeenCalled();
	});

	// A Stripe recusa string vazia em parâmetro opcional, e o painel manda
	// `description` sempre — em branco inclusive.
	it('não envia descrição vazia ao Stripe', async () => {
		const plan = buildPlan({ description: '' });
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		await service.updatePlan('plan_1', { name: 'Plano Renomeado' } as any);

		expect(mockStripeService.updateProduct).toHaveBeenCalledWith('prod_123', {
			name: 'Plano Renomeado',
			description: undefined,
			active: true,
		});
	});

	it('preserva o produto existente quando ele é válido', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		mockStripeService.createProduct = jest.fn();

		await service.updatePlan('plan_1', { name: 'Plano Renomeado' } as any);

		expect(mockStripeService.createProduct).not.toHaveBeenCalled();
		expect(plan.stripeProductId).toBe('prod_123');
	});
});

describe('AdminService — deactivatePlan', () => {
	let service: AdminService;
	let mockSubscriptionModel: any;
	let mockStripeService: any;

	function buildPlan(overrides: Record<string, any> = {}) {
		const plan: any = {
			_id: 'plan_1',
			name: 'Plano Mensal',
			description: 'Descrição',
			stripeProductId: 'prod_123',
			isActive: true,
			...overrides,
		};
		plan.save = jest.fn().mockResolvedValue(plan);
		return plan;
	}

	beforeEach(async () => {
		mockSubscriptionModel = { findById: jest.fn() };
		mockStripeService = {
			updateProduct: jest.fn().mockResolvedValue({}),
			createProduct: jest.fn(),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AdminService,
				{ provide: getModelToken('User'), useValue: {} },
				{
					provide: getModelToken('Subscription'),
					useValue: mockSubscriptionModel,
				},
				{ provide: getModelToken('UserSubscription'), useValue: {} },
				{ provide: getModelToken('ManualGrantAudit'), useValue: {} },
				{ provide: StripeService, useValue: mockStripeService },
			],
		}).compile();

		service = module.get<AdminService>(AdminService);
	});

	it('desativa o produto no Stripe junto com o plano', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);

		await service.deactivatePlan('plan_1');

		// Nome e descrição não têm o que mudar numa desativação, e mandá-los
		// arrastaria o plano para a rejeição de string vazia da Stripe.
		expect(mockStripeService.updateProduct).toHaveBeenCalledWith('prod_123', {
			description: undefined,
			active: false,
		});
		expect(plan.isActive).toBe(false);
		expect(plan.save).toHaveBeenCalled();
	});

	// Repor um produto só para desativá-lo em seguida deixaria lixo no Stripe.
	it('limpa o vínculo sem recriar produto quando o ID não existe na conta', async () => {
		const plan = buildPlan();
		mockSubscriptionModel.findById.mockResolvedValue(plan);
		mockStripeService.updateProduct.mockRejectedValue(
			Object.assign(new Error('No such product'), {
				code: 'resource_missing',
			})
		);

		await service.deactivatePlan('plan_1');

		expect(mockStripeService.createProduct).not.toHaveBeenCalled();
		expect(plan.stripeProductId).toBeUndefined();
		expect(plan.isActive).toBe(false);
		expect(plan.save).toHaveBeenCalled();
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
	let mockUserSubscriptionModel: any;

	beforeEach(async () => {
		mockManualGrantAuditModel = {
			find: jest.fn(),
			countDocuments: jest.fn(),
		};
		mockUserSubscriptionModel = {
			find: jest.fn().mockReturnValue({
				select: jest.fn().mockReturnThis(),
				lean: jest.fn().mockResolvedValue([]),
			}),
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AdminService,
				{ provide: getModelToken('User'), useValue: {} },
				{ provide: getModelToken('Subscription'), useValue: {} },
				{
					provide: getModelToken('UserSubscription'),
					useValue: mockUserSubscriptionModel,
				},
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
			user: '507f1f77bcf86cd799439099',
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
			status: 'expired',
		});
	});

	it('marks the grant as "active" when the user has a current active/trialing subscription that has not expired', async () => {
		const userId = '507f1f77bcf86cd799439099';
		const record = {
			_id: 'grant-1',
			user: userId,
			userEmail: 'user@example.com',
			plan: { _id: 'plan-1', name: 'Pro' },
			grantType: ManualGrantType.Permanent,
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
		mockUserSubscriptionModel.find.mockReturnValue({
			select: jest.fn().mockReturnThis(),
			lean: jest.fn().mockResolvedValue([
				{
					user: userId,
					status: 'active',
					currentPeriodEnd: new Date('2099-12-31'),
				},
			]),
		});

		const result = await service.listManualGrants({ page: 1, limit: 20 });

		expect(result.items[0].status).toBe('active');
	});

	it('marks the grant as "expired" when the matching subscription period has already ended', async () => {
		const userId = '507f1f77bcf86cd799439099';
		const record = {
			_id: 'grant-1',
			user: userId,
			userEmail: 'user@example.com',
			plan: { _id: 'plan-1', name: 'Pro' },
			grantType: ManualGrantType.Trial,
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
		mockUserSubscriptionModel.find.mockReturnValue({
			select: jest.fn().mockReturnThis(),
			lean: jest.fn().mockResolvedValue([
				{
					user: userId,
					status: 'trialing',
					currentPeriodEnd: new Date('2020-01-01'),
				},
			]),
		});

		const result = await service.listManualGrants({ page: 1, limit: 20 });

		expect(result.items[0].status).toBe('expired');
	});

	// Regressão: um registro de auditoria com `user` ausente/corrompido
	// virava `new Types.ObjectId(String(undefined))` — lançava e derrubava a
	// página inteira do histórico com 500, não só aquele registro.
	it('does not throw when a grant record has a missing/invalid user id — falls back to "expired" for that record', async () => {
		const record = {
			_id: 'grant-1',
			user: undefined,
			userEmail: 'user@example.com',
			plan: { _id: 'plan-1', name: 'Pro' },
			grantType: ManualGrantType.Trial,
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

		expect(result.items[0].status).toBe('expired');
		expect(mockUserSubscriptionModel.find).not.toHaveBeenCalled();
	});
});
