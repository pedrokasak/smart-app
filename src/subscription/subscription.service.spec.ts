import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { WebhooksService } from './webhooks.service';

describe('SubscriptionService', () => {
	let service: SubscriptionService;

	const mockSubscriptionModel = {
		find: jest.fn(),
		findById: jest.fn(),
		findOne: jest.fn(),
		create: jest.fn(),
		save: jest.fn(),
		sort: jest.fn(),
	};

	const mockUserSubscriptionModel = {
		findOne: jest.fn(),
		save: jest.fn(),
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
				{
					provide: StripeService,
					useValue: mockStripeService,
				},
				{
					provide: WebhooksService,
					useValue: mockWebhooksService,
				},
			],
		}).compile();

		service = module.get<SubscriptionService>(SubscriptionService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('findAllSubscriptions', () => {
		it('should return all active subscriptions', async () => {
			const result = [{ name: 'Plano A' }];
			mockSubscriptionModel.find.mockReturnValue({
				sort: jest.fn().mockResolvedValue(result),
			});

			const subscriptions = await service.findAllSubscriptions();
			expect(subscriptions).toEqual(result);
			expect(mockSubscriptionModel.find).toHaveBeenCalledWith({
				isActive: true,
			});
		});

		it('should throw BadRequestException on error', async () => {
			mockSubscriptionModel.find.mockImplementation(() => {
				throw new Error();
			});

			await expect(service.findAllSubscriptions()).rejects.toThrow(
				BadRequestException
			);
		});
	});

	describe('findSubscriptionById', () => {
		it('should return a subscription by id', async () => {
			const result = { name: 'Plano A' };
			mockSubscriptionModel.findById.mockResolvedValue(result);

			const subscription = await service.findSubscriptionById('123');
			expect(subscription).toEqual(result);
		});

		it('should throw NotFoundException if not found', async () => {
			mockSubscriptionModel.findById.mockResolvedValue(null);
			await expect(service.findSubscriptionById('123')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('removeSubscription', () => {
		it('should disable a subscription', async () => {
			const mockSubscription = {
				name: 'Plano A',
				isActive: true,
				save: jest.fn(),
			};
			mockSubscriptionModel.findById.mockResolvedValue(mockSubscription);

			const result = await service.removeSubscription('123');
			expect(result).toEqual({ message: 'Plano desativado com sucesso' });
			expect(mockSubscription.isActive).toBe(false);
			expect(mockSubscription.save).toHaveBeenCalled();
		});

		it('should throw NotFoundException if subscription not found', async () => {
			mockSubscriptionModel.findById.mockResolvedValue(null);

			await expect(service.removeSubscription('123')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('createSubscription', () => {
		it('should create a subscription with new product and price', async () => {
			const dto = {
				name: 'Pro',
				price: 10,
			} as any;

			mockStripeService.createProduct.mockResolvedValue({ id: 'prod_123' });
			mockStripeService.createPrice.mockResolvedValue({ id: 'price_123' });

			const mockSave = jest.fn();
			const mockNew = jest.fn().mockImplementation(() => ({ save: mockSave }));

			(mockSubscriptionModel as any).mockImplementation = mockNew;

			service['subscriptionModel'] = jest.fn().mockImplementation(() => ({
				save: mockSave,
			})) as any;

			await service.createSubscription(dto);
			expect(mockStripeService.createProduct).toHaveBeenCalled();
			expect(mockStripeService.createPrice).toHaveBeenCalled();
		});
	});

	describe('checkExpiredSubscriptions', () => {
		it('should call webhooksService.checkExpiredSubscriptions', async () => {
			await service.checkExpiredSubscriptions();
			expect(mockWebhooksService.checkExpiredSubscriptions).toHaveBeenCalled();
		});
	});
});
