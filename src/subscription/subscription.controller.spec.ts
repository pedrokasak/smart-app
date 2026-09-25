import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto';
import { WebhooksService } from 'src/subscription/webhooks.service';
import { StripeService } from 'src/subscription/stripe.service';
import { IS_PUBLIC_KEY } from 'src/utils/constants';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	USER_PLAN_RESOLVER,
} from 'src/subscription/application/user-plan.types';

const mockSubscriptionModel = {
	create: jest.fn(),
	find: jest.fn(),
	findById: jest.fn(),
	findByIdAndUpdate: jest.fn(),
	findByIdAndDelete: jest.fn(),
};

const mockUserSubscriptionModel = {
	create: jest.fn(),
	find: jest.fn(),
};

const mockUserModel = {
	findById: jest.fn(),
};

const mockStripeService = {
	createCheckoutSession: jest.fn(),
};

const mockWebhooksService = {
	handleWebhook: jest.fn(),
};

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('SubscriptionController', () => {
	let controller: SubscriptionController;
	let service: SubscriptionService;

	const mockSubscriptionService = {
		createSubscription: jest.fn(),
		findAllSubscriptions: jest.fn(),
		findSubscriptionById: jest.fn(),
		updateSubscription: jest.fn(),
		removeSubscription: jest.fn(),
		createCheckoutSession: jest.fn(),
		createPortalSession: jest.fn(),
		cancelUserSubscription: jest.fn(),
		listUserInvoices: jest.fn(),
		findCurrentSubscriptionByUser: jest.fn(),
	};

	const req = { user: { userId: 'token-user' } };
	const mockPlanResolver = {
		resolve: jest.fn(),
		resolveWithCapabilities: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [SubscriptionController],
			providers: [
				{
					provide: SubscriptionService,
					useValue: mockSubscriptionService,
				},
				{ provide: 'SubscriptionModel', useValue: mockSubscriptionModel },
				{
					provide: 'UserSubscriptionModel',
					useValue: mockUserSubscriptionModel,
				},
				{ provide: 'UserModel', useValue: mockUserModel },
				{ provide: StripeService, useValue: mockStripeService },
				{ provide: WebhooksService, useValue: mockWebhooksService },
				{ provide: USER_PLAN_RESOLVER, useValue: mockPlanResolver },
			],
		}).compile();

		service = module.get<SubscriptionService>(SubscriptionService);
		controller = module.get<SubscriptionController>(SubscriptionController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	describe('getCurrentSubscription — capabilities (TRA-200)', () => {
		beforeEach(() => {
			mockSubscriptionService.findCurrentSubscriptionByUser.mockResolvedValue(
				null
			);
		});

		it('plano grátis não recebe nenhuma capability paga', async () => {
			mockPlanResolver.resolveWithCapabilities.mockResolvedValue({
				tier: FREE_ACCESS_LEVEL,
				capabilities: [],
			});

			const result = await controller.getCurrentSubscription(req);

			expect(result.capabilities).toEqual([]);
			expect(
				mockSubscriptionService.findCurrentSubscriptionByUser
			).toHaveBeenCalledWith('token-user');
			expect(mockPlanResolver.resolveWithCapabilities).toHaveBeenCalledWith(
				'token-user'
			);
		});

		it('Pro libera comparador mas não o resumo de RI por IA', async () => {
			mockPlanResolver.resolveWithCapabilities.mockResolvedValue({
				tier: PRO_ACCESS_LEVEL,
				capabilities: [],
			});

			const { capabilities } = await controller.getCurrentSubscription(req);

			expect(capabilities).toContain('research.comparator');
			expect(capabilities).not.toContain('ri.ai_summary');
		});

		it('Wealth libera comparador e resumo de RI por IA', async () => {
			mockPlanResolver.resolveWithCapabilities.mockResolvedValue({
				tier: PREMIUM_ACCESS_LEVEL,
				capabilities: [],
			});

			const { capabilities } = await controller.getCurrentSubscription(req);

			expect(capabilities).toEqual(
				expect.arrayContaining(['research.comparator', 'ri.ai_summary'])
			);
		});

		it('checkbox do admin manda sobre o patamar quando ele decidiu', async () => {
			mockPlanResolver.resolveWithCapabilities.mockResolvedValue({
				tier: PREMIUM_ACCESS_LEVEL,
				capabilities: ['ai.insights'],
				capabilitiesKnown: ['ai.insights', 'ri.ai_summary'],
			});

			const { capabilities } = await controller.getCurrentSubscription(req);

			expect(capabilities).toContain('ai.insights');
			expect(capabilities).not.toContain('ri.ai_summary');
		});
	});

	describe('create', () => {
		it('should create a subscription', async () => {
			const dto: CreateSubscriptionDto = {
				name: 'Plano Pro',
				description: 'Acesso Pro',
				price: 100,
			} as any;

			const result = { ...dto, _id: 'abc123' };
			mockSubscriptionService.createSubscription.mockResolvedValue(result);

			expect(await controller.create(dto)).toEqual(result);
			expect(service.createSubscription).toHaveBeenCalledWith(dto);
		});
	});

	describe('findAll', () => {
		it('should return all subscriptions', async () => {
			const result = [{ name: 'Plano A' }, { name: 'Plano B' }];
			mockSubscriptionService.findAllSubscriptions.mockResolvedValue(result);

			expect(await controller.findAll()).toEqual(result);
			expect(service.findAllSubscriptions).toHaveBeenCalled();
		});
	});

	describe('findOne', () => {
		it('should return one subscription', async () => {
			const result = { _id: 'abc123', name: 'Plano A' };
			mockSubscriptionService.findSubscriptionById.mockResolvedValue(result);

			expect(await controller.findOne('abc123')).toEqual(result);
			expect(service.findSubscriptionById).toHaveBeenCalledWith('abc123');
		});

		it('should throw NotFoundException if not found', async () => {
			mockSubscriptionService.findSubscriptionById.mockRejectedValue(
				new NotFoundException('Plano não encontrado')
			);

			await expect(controller.findOne('not-exist')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('update', () => {
		it('should update subscription', async () => {
			const dto: UpdateSubscriptionDto = { name: 'Plano Atualizado' } as any;
			const result = { _id: 'abc123', ...dto };

			mockSubscriptionService.updateSubscription.mockResolvedValue(result);

			expect(await controller.update('abc123', dto)).toEqual(result);
			expect(service.updateSubscription).toHaveBeenCalledWith('abc123', dto);
		});
	});

	describe('remove', () => {
		it('should remove subscription', async () => {
			const result = { message: 'Plano desativado com sucesso' };

			mockSubscriptionService.removeSubscription.mockResolvedValue(result);

			expect(await controller.remove('abc123')).toEqual(result);
			expect(service.removeSubscription).toHaveBeenCalledWith('abc123');
		});
	});

	describe('createCheckout', () => {
		it('should create a checkout session', async () => {
			const body = {
				userId: 'user123',
				successUrl: 'http://success',
				cancelUrl: 'http://cancel',
			};
			const result = { sessionId: 'sess_123', url: 'http://stripe.url' };

			mockSubscriptionService.createCheckoutSession.mockResolvedValue(result);

			expect(await controller.createCheckout('sub123', body, req)).toEqual(
				result
			);
			expect(service.createCheckoutSession).toHaveBeenCalledWith(
				'token-user',
				'sub123',
				body.successUrl,
				body.cancelUrl,
				undefined
			);
		});

		it('should pass billingInterval through to the service', async () => {
			const body = {
				userId: 'user123',
				successUrl: 'http://success',
				cancelUrl: 'http://cancel',
				billingInterval: 'annual' as const,
			};
			const result = { sessionId: 'sess_123', url: 'http://stripe.url' };

			mockSubscriptionService.createCheckoutSession.mockResolvedValue(result);

			expect(await controller.createCheckout('sub123', body, req)).toEqual(
				result
			);
			expect(service.createCheckoutSession).toHaveBeenCalledWith(
				'token-user',
				'sub123',
				body.successUrl,
				body.cancelUrl,
				'annual'
			);
		});
	});

	describe('account routes use the token user, never the body', () => {
		it('opens the billing portal for the token user', async () => {
			mockSubscriptionService.createPortalSession.mockResolvedValue({
				url: 'u',
			});
			await controller.createPortalSession(
				{
					returnUrl: 'https://trackerr.com.br/subscription',
					userId: 'victim',
				} as any,
				req
			);
			expect(service.createPortalSession).toHaveBeenCalledWith(
				'token-user',
				'https://trackerr.com.br/subscription'
			);
		});

		it('cancels only the token user subscription', async () => {
			await controller.cancelSubscription(req);
			expect(service.cancelUserSubscription).toHaveBeenCalledWith('token-user');
		});

		it('ignores a different userId in the checkout body', async () => {
			await controller.createCheckout(
				'sub123',
				{ userId: 'victim', successUrl: 's', cancelUrl: 'c' },
				req
			);
			expect(service.createCheckoutSession).toHaveBeenCalledWith(
				'token-user',
				'sub123',
				's',
				'c',
				undefined
			);
		});

		it('lists invoices of the token user', async () => {
			mockSubscriptionService.listUserInvoices.mockResolvedValue([]);
			await expect(controller.listInvoices(req)).resolves.toEqual([]);
			expect(service.listUserInvoices).toHaveBeenCalledWith('token-user');
		});

		it('rejects a request without an authenticated user', () => {
			expect(() => controller.listInvoices({})).toThrow(ForbiddenException);
		});
	});

	describe('SubscriptionController — public routes', () => {
		it('marks findAll as public (no auth required)', () => {
			const reflector = new Reflector();
			const isPublic = reflector.get(
				IS_PUBLIC_KEY,
				SubscriptionController.prototype.findAll
			);
			expect(isPublic).toBe(true);
		});
	});

	describe('SubscriptionController — plan mutation role protection', () => {
		const rolesGuard = new RolesGuard(new Reflector());

		const buildContext = (
			handler: (...args: any[]) => any,
			role: Role
		): ExecutionContext =>
			({
				getHandler: () => handler,
				getClass: () => SubscriptionController,
				switchToHttp: () => ({
					getRequest: () => ({ user: { userId: 'user-1', role } }),
				}),
			}) as unknown as ExecutionContext;

		const protectedHandlers: Array<[string, (...args: any[]) => any]> = [
			['create', SubscriptionController.prototype.create],
			['update', SubscriptionController.prototype.update],
			['updateFeatures', SubscriptionController.prototype.updateFeatures],
			['remove', SubscriptionController.prototype.remove],
		];

		it.each(protectedHandlers)(
			'denies %s to a non-admin authenticated user (403)',
			(_name, handler) => {
				const context = buildContext(handler, Role.User);

				expect(() => rolesGuard.canActivate(context)).toThrow(
					ForbiddenException
				);
			}
		);

		it.each(protectedHandlers)(
			'allows %s for an admin user',
			(_name, handler) => {
				const context = buildContext(handler, Role.Admin);

				expect(rolesGuard.canActivate(context)).toBe(true);
			}
		);
	});
});
