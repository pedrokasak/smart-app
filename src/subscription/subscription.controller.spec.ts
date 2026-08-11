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
			],
		}).compile();

		service = module.get<SubscriptionService>(SubscriptionService);
		controller = module.get<SubscriptionController>(SubscriptionController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
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

			expect(await controller.createCheckout('sub123', body)).toEqual(result);
			expect(service.createCheckoutSession).toHaveBeenCalledWith(
				body.userId,
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

			expect(await controller.createCheckout('sub123', body)).toEqual(result);
			expect(service.createCheckoutSession).toHaveBeenCalledWith(
				body.userId,
				'sub123',
				body.successUrl,
				body.cancelUrl,
				'annual'
			);
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

		const protectedHandlers: Array<
			[string, (...args: any[]) => any]
		> = [
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
