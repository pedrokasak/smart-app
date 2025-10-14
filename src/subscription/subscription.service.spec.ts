import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { WebhooksController } from 'src/subscription/webhooks.controller';
import { WebhooksService } from 'src/subscription/webhooks.service';
import { NotFoundException } from '@nestjs/common';
import { StripeService } from 'src/subscription/stripe.service';
import { getModelToken } from '@nestjs/mongoose';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('SubscriptionService', () => {
	let service: SubscriptionService;
	const mockSubscriptionModel = {
		find: jest.fn(),
		findById: jest.fn(),
		save: jest.fn(),
	};
	const mockUserSubscriptionModel = {
		findOne: jest.fn(),
		create: jest.fn(),
	};
	const mockUserModel = {
		findById: jest.fn(),
	};
	const mockStripeService = {
		createProduct: jest.fn(),
		createPrice: jest.fn(),
		createSubscription: jest.fn(),
		cancelSubscription: jest.fn(),
		createCheckoutSession: jest.fn(),
		createCustomerPortalSession: jest.fn(),
	};
	const mockWebhooksService = {
		checkExpiredSubscriptions: jest.fn(),
		handleWebhook: jest.fn(),
	};

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

describe('WebhooksController', () => {
	let controller: WebhooksController;
	const mockWebhooksService = {
		handleWebhook: jest.fn(),
	};

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
				body: { id: 'evt_test', type: 'checkout.session.completed' },
			};
			const res: any = {
				status: jest.fn().mockReturnThis(),
				json: jest.fn(),
			};
			// Mock Stripe webhook constructEvent
			(controller as any).stripe = {
				webhooks: { constructEvent: jest.fn().mockReturnValue(req.body) },
			};
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
