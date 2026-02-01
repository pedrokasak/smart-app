import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { WebhooksController } from 'src/subscription/webhooks.controller';
import { WebhooksService } from 'src/subscription/webhooks.service';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { StripeService } from 'src/subscription/stripe.service';
import { SubscriptionController } from 'src/subscription/subscription.controller';
import { CreateSubscriptionDto } from 'src/subscription/dto';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

jest.mock('stripe', () => {
	return jest.fn().mockImplementation(() => ({
		webhooks: {
			constructEvent: jest.fn(),
		},
	}));
});

describe('SubscriptionService', () => {
	let service: SubscriptionService;

	const mockSubscriptionModel = {
		create: jest.fn(),
		find: jest.fn(),
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
	};
	const mockUserSubscriptionModel = { findOne: jest.fn(), create: jest.fn() };
	const mockUserModel = { findById: jest.fn() };
	const mockStripeService = {
		createProduct: jest.fn().mockResolvedValue({ id: 'prod_123' }),
		createPrice: jest.fn().mockResolvedValue({ id: 'price_123' }),
		createSubscription: jest.fn(),
		cancelSubscription: jest.fn(),
		createCheckoutSession: jest
			.fn()
			.mockResolvedValue({ sessionId: 'sess_123', url: 'http://stripe.url' }),
		createCustomerPortalSession: jest.fn(),
	};
	const mockWebhooksService = {
		checkExpiredSubscriptions: jest.fn(),
		handleWebhook: jest.fn(),
	};

	mockSubscriptionModel.find.mockReturnValue({
		sort: jest.fn().mockResolvedValue([]), // retorna um array vazio ou dados mockados
	});

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				SubscriptionService,
				{
					provide: getModelToken('Subscription'),
					useValue: mockSubscriptionModel,
				},
				{
					provide: getModelToken('UserSubscription'),
					useValue: mockUserSubscriptionModel,
				},
				{ provide: getModelToken('User'), useValue: mockUserModel },
				{ provide: StripeService, useValue: mockStripeService },
				{ provide: WebhooksService, useValue: mockWebhooksService },
			],
		}).compile();

		service = module.get<SubscriptionService>(SubscriptionService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('findSubscriptionById', () => {
		it('should return a subscription if found', async () => {
			const sub = { _id: '123', name: 'Plano Teste' };
			mockSubscriptionModel.findById.mockResolvedValue(sub);

			const result = await service.findSubscriptionById('123');
			expect(result).toEqual(sub);
		});

		it('should throw NotFoundException if not found', async () => {
			mockSubscriptionModel.findById.mockResolvedValue(null);
			await expect(service.findSubscriptionById('not-exist')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('checkExpiredSubscriptions', () => {
		it('should call webhooksService.checkExpiredSubscriptions', async () => {
			mockWebhooksService.checkExpiredSubscriptions.mockResolvedValue('ok');
			const result = await service.checkExpiredSubscriptions();
			expect(result).toBe('ok');
			expect(mockWebhooksService.checkExpiredSubscriptions).toHaveBeenCalled();
		});
	});
});

describe('SubscriptionController', () => {
	let controller: SubscriptionController;

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
				{ provide: SubscriptionService, useValue: mockSubscriptionService },
			],
		}).compile();

		controller = module.get<SubscriptionController>(SubscriptionController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	describe('create', () => {
		it('should create a subscription', async () => {
			const dto: CreateSubscriptionDto = {
				name: 'Teste',
				price: 29.99,
				interval: 'month',
				stripePriceId: 'price_123',
			};
			const result = { id: 'abc123', ...dto };
			mockSubscriptionService.createSubscription.mockResolvedValue(result);

			expect(await controller.create(dto)).toEqual(result);
			expect(mockSubscriptionService.createSubscription).toHaveBeenCalledWith(
				dto
			);
		});
	});

	describe('findAll', () => {
		it('should return all subscriptions', async () => {
			const result = [{ id: '1' }, { id: '2' }];
			mockSubscriptionService.findAllSubscriptions.mockResolvedValue(result);

			expect(await controller.findAll()).toEqual(result);
			expect(mockSubscriptionService.findAllSubscriptions).toHaveBeenCalled();
		});
	});

	describe('findOne', () => {
		it('should return one subscription', async () => {
			const result = { id: 'abc123' };
			mockSubscriptionService.findSubscriptionById.mockResolvedValue(result);

			expect(await controller.findOne('abc123')).toEqual(result);
			expect(mockSubscriptionService.findSubscriptionById).toHaveBeenCalledWith(
				'abc123'
			);
		});

		it('should throw NotFoundException if not found', async () => {
			mockSubscriptionService.findSubscriptionById.mockRejectedValue(
				new NotFoundException()
			);

			await expect(controller.findOne('not-exist')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('update', () => {
		it('should update subscription', async () => {
			const dto = { name: 'Updated' };
			const result = { id: 'abc123', ...dto };
			mockSubscriptionService.updateSubscription.mockResolvedValue(result);

			expect(await controller.update('abc123', dto)).toEqual(result);
			expect(mockSubscriptionService.updateSubscription).toHaveBeenCalledWith(
				'abc123',
				dto
			);
		});
	});

	describe('remove', () => {
		it('should remove subscription', async () => {
			const result = { success: true };
			mockSubscriptionService.removeSubscription.mockResolvedValue(result);

			expect(await controller.remove('abc123')).toEqual(result);
			expect(mockSubscriptionService.removeSubscription).toHaveBeenCalledWith(
				'abc123'
			);
		});
	});

	describe('createCheckout', () => {
		it('should create a checkout session', async () => {
			const body = {
				userId: 'user1',
				successUrl: 'http://success.url',
				cancelUrl: 'http://cancel.url',
			};
			const result = { sessionId: 'sess_123' };
			mockSubscriptionService.createCheckoutSession.mockResolvedValue(result);

			expect(await controller.createCheckout('sub123', body)).toEqual(result);
			expect(
				mockSubscriptionService.createCheckoutSession
			).toHaveBeenCalledWith(
				body.userId,
				'sub123',
				body.successUrl,
				body.cancelUrl
			);
		});
	});
});

describe('WebhooksController', () => {
	let controller: WebhooksController;

	const mockWebhooksService = { handleWebhook: jest.fn() };

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [WebhooksController],
			providers: [{ provide: WebhooksService, useValue: mockWebhooksService }],
		}).compile();

		controller = module.get<WebhooksController>(WebhooksController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	describe('handleStripeWebhook', () => {
		it('should call handleWebhook and return status 200', async () => {
			const req: any = {
				headers: { 'stripe-signature': 'sig_test' },
				body: { id: 'evt_test' },
			};
			const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

			mockWebhooksService.handleWebhook.mockResolvedValue(true);

			await controller.handleStripeWebhook(req, res);

			expect(mockWebhooksService.handleWebhook).toHaveBeenCalledWith(req.body);
			expect(res.status).toHaveBeenCalledWith(200);
			expect(res.json).toHaveBeenCalledWith({ received: true });
		});

		it('should return 400 if signature invalid', async () => {
			const req: any = {
				headers: { 'stripe-signature': 'sig_test' },
				body: {},
			};
			const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

			(controller as any).stripe = {
				webhooks: {
					constructEvent: jest.fn().mockImplementation(() => {
						throw new Error('Invalid');
					}),
				},
			};

			await controller.handleStripeWebhook(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: 'Assinatura inválida' });
		});
	});
});
