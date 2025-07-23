import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { NotFoundException } from '@nestjs/common';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto';

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
			],
		}).compile();

		controller = module.get<SubscriptionController>(SubscriptionController);
		service = module.get<SubscriptionService>(SubscriptionService);
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
				body.cancelUrl
			);
		});
	});
});
