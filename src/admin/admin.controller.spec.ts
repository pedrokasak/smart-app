import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Role } from 'src/auth/enums/role.enum';
import { ManualGrantType } from './constants/admin.constants';

describe('AdminController', () => {
	let controller: AdminController;
	let service: typeof mockAdminService;

	const mockAdminService = {
		getOverview: jest.fn(),
		listPlans: jest.fn(),
		createPlan: jest.fn(),
		updatePlan: jest.fn(),
		deactivatePlan: jest.fn(),
		updateUserRoleByEmail: jest.fn(),
		grantSubscriptionByEmail: jest.fn(),
		listManualGrants: jest.fn(),
		getWebhookStatus: jest.fn(),
		listWebhookEvents: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AdminController],
			providers: [
				{
					provide: AdminService,
					useValue: mockAdminService,
				},
			],
		}).compile();

		controller = module.get<AdminController>(AdminController);
		service = module.get(AdminService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	it('returns admin overview metrics', async () => {
		const response = {
			totalActiveSubscriptions: 3,
			totalTrialSubscriptions: 1,
			totalManualGrants: 2,
			mostUsedPlan: { planId: 'plan-1', planName: 'Pro', count: 2 },
			usersByPlan: [{ planId: 'plan-1', planName: 'Pro', count: 2 }],
		};
		service.getOverview.mockResolvedValue(response);

		await expect(controller.getOverview()).resolves.toEqual(response);
		expect(service.getOverview).toHaveBeenCalled();
	});

	it('creates a plan', async () => {
		const payload = {
			name: 'Premium',
			description: 'Plano premium',
			price: 99,
			currency: 'brl',
			interval: 'month' as const,
			intervalCount: 1,
			features: ['chat', 'dashboard'],
		};
		service.createPlan.mockResolvedValue({ _id: 'plan-1', ...payload });

		await expect(controller.createPlan(payload)).resolves.toMatchObject(
			payload
		);
		expect(service.createPlan).toHaveBeenCalledWith(payload);
	});

	it('updates a plan by id', async () => {
		service.updatePlan.mockResolvedValue({ _id: 'plan-1', name: 'Atualizado' });

		await expect(
			controller.updatePlan('plan-1', { name: 'Atualizado' })
		).resolves.toEqual({ _id: 'plan-1', name: 'Atualizado' });
		expect(service.updatePlan).toHaveBeenCalledWith('plan-1', {
			name: 'Atualizado',
		});
	});

	it('delegates user role update by email', async () => {
		service.updateUserRoleByEmail.mockResolvedValue({
			message: 'Role atualizada com sucesso',
		});

		await expect(
			controller.updateUserRole({
				email: 'editor@example.com',
				role: Role.Editor,
			})
		).resolves.toEqual({ message: 'Role atualizada com sucesso' });
		expect(service.updateUserRoleByEmail).toHaveBeenCalledWith(
			'editor@example.com',
			Role.Editor
		);
	});

	it('grants subscription by email using authenticated admin/editor context', async () => {
		service.grantSubscriptionByEmail.mockResolvedValue({
			message: 'Concessão manual aplicada com sucesso',
		});

		const req = { user: { userId: 'admin-1' } };
		const body = {
			email: 'user@example.com',
			planId: 'plan-1',
			grantType: ManualGrantType.Trial,
			trialDurationDays: 14,
			discountPercent: 10,
			notes: 'Cortesia',
		};

		await expect(controller.grantSubscription(req, body)).resolves.toEqual({
			message: 'Concessão manual aplicada com sucesso',
		});
		expect(service.grantSubscriptionByEmail).toHaveBeenCalledWith(
			'admin-1',
			body
		);
	});

	it('lists manual grant history with pagination', async () => {
		const response = {
			items: [
				{
					id: 'grant-1',
					userEmail: 'user@example.com',
					planId: 'plan-1',
					planName: 'Pro',
					grantType: ManualGrantType.Trial,
					trialDurationDays: 14,
					discountPercent: 10,
					performedByEmail: 'admin@example.com',
					createdAt: new Date('2026-01-01'),
				},
			],
			page: 1,
			limit: 20,
			total: 1,
		};
		service.listManualGrants.mockResolvedValue(response);

		await expect(
			controller.listGrants({ page: 1, limit: 20 })
		).resolves.toEqual(response);
		expect(service.listManualGrants).toHaveBeenCalledWith({
			page: 1,
			limit: 20,
		});
	});

	it('returns the webhook status', async () => {
		service.getWebhookStatus.mockReturnValue({ configured: true });

		expect(controller.getWebhookStatus()).toEqual({ configured: true });
		expect(service.getWebhookStatus).toHaveBeenCalled();
	});

	it('lists recent webhook events with a parsed limit', async () => {
		const events = [{ id: 'evt_1', type: 'invoice.paid' }];
		service.listWebhookEvents.mockResolvedValue(events);

		await expect(controller.listWebhookEvents('10')).resolves.toEqual(events);
		expect(service.listWebhookEvents).toHaveBeenCalledWith(10);
	});

	it('lists recent webhook events with default limit when not provided', async () => {
		service.listWebhookEvents.mockResolvedValue([]);

		await expect(controller.listWebhookEvents()).resolves.toEqual([]);
		expect(service.listWebhookEvents).toHaveBeenCalledWith(undefined);
	});
});
