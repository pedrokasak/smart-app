import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { WebhooksService } from 'src/subscription/webhooks.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
	let mockSubscriptionModel: any;
	let mockUserSubscriptionModel: any;
	let mockUserModel: any;
	let mockStripeService: any;
	let mockWebhooksService: any;

	beforeEach(async () => {
		mockSubscriptionModel = jest.fn().mockImplementation((dto) => ({
			...dto,
			save: jest.fn().mockResolvedValue({
				_id: 'sub123',
				...dto,
			}),
		}));

		mockSubscriptionModel.find = jest.fn().mockReturnValue({
			sort: jest.fn().mockResolvedValue([]),
		});

		mockSubscriptionModel.findById = jest.fn();
		mockUserSubscriptionModel = { findOne: jest.fn(), create: jest.fn() };
		mockUserModel = { findById: jest.fn() };
		mockStripeService = {
			createProduct: jest.fn().mockResolvedValue({ id: 'prod_123' }),
			createPrice: jest.fn().mockResolvedValue({ id: 'price_123' }),
			createCheckoutSession: jest.fn(),
		};
		mockWebhooksService = {
			checkExpiredSubscriptions: jest.fn(),
			handleWebhook: jest.fn(),
		};
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

	describe('createCheckoutSession — billing interval', () => {
		const plan = {
			_id: 'plan_1',
			price: 149,
			isActive: true,
			stripePriceId: 'price_monthly_123',
			annualStripePriceId: 'price_annual_123',
		};

		beforeEach(() => {
			mockUserModel.findById.mockResolvedValue({ _id: 'user_1' });
			mockSubscriptionModel.findById.mockResolvedValue(plan);
			mockStripeService.createCheckoutSession.mockResolvedValue({
				url: 'https://checkout.stripe.com/x',
			});
		});

		it('uses stripePriceId when billingInterval is monthly (default)', async () => {
			await service.createCheckoutSession(
				'user_1',
				'plan_1',
				'https://ok',
				'https://cancel'
			);

			expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
				'user_1',
				'price_monthly_123',
				'https://ok',
				'https://cancel'
			);
		});

		it('uses annualStripePriceId when billingInterval is annual', async () => {
			await service.createCheckoutSession(
				'user_1',
				'plan_1',
				'https://ok',
				'https://cancel',
				'annual'
			);

			expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
				'user_1',
				'price_annual_123',
				'https://ok',
				'https://cancel'
			);
		});

		/**
		 * TRA-150. O comportamento anterior era cair no preço MENSAL quando o
		 * plano não tinha preço anual, emitindo apenas um `logger.warn`. Isso
		 * cobrava um ciclo diferente do que o usuário escolheu, e ninguém via —
		 * em produção os três planos estavam sem `annualStripePriceId`, então
		 * todo checkout "anual" virava mensal em silêncio. Falhar alto é o
		 * único comportamento defensável quando o que está em jogo é qual
		 * valor entra no cartão de alguém.
		 */
		it('rejects annual checkout when annualStripePriceId is not configured', async () => {
			mockSubscriptionModel.findById.mockResolvedValue({
				...plan,
				annualStripePriceId: undefined,
			});

			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel',
					'annual'
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
		});

		it('rejects an invalid billingInterval instead of silently charging monthly', async () => {
			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel',
					'yearly' as any
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
		});

		/**
		 * Plano gratuito não tem o que cobrar. Em produção o plano Free tinha
		 * um `stripePriceId` órfão e o checkout devolvia 400 do próprio Stripe
		 * ("No such price"), o que expõe erro de integração ao usuário em vez
		 * de tratar a regra de negócio aqui (TRA-150).
		 */
		it('rejects checkout for a free plan (price 0) without calling Stripe', async () => {
			mockSubscriptionModel.findById.mockResolvedValue({
				...plan,
				price: 0,
			});

			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel'
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
		});

		/**
		 * CLAUDE.md §6.2: o frontend só melhora UX, quem decide é o backend. A
		 * landing já esconde plano "em breve", mas esconder não é impedir.
		 */
		it('rejects checkout for a coming-soon plan', async () => {
			mockSubscriptionModel.findById.mockResolvedValue({
				...plan,
				isComingSoon: true,
			});

			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel'
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
		});

		/**
		 * `removeSubscription` aposenta plano por soft-delete (`isActive =
		 * false`) e a listagem pública já filtra por `isActive: true`. Sem esta
		 * checagem o plano some da vitrine mas continua contratável por quem
		 * ainda tem o ID — o caso simétrico do `isComingSoon`.
		 */
		it('rejects checkout for an inactive (retired) plan', async () => {
			mockSubscriptionModel.findById.mockResolvedValue({
				...plan,
				isActive: false,
			});

			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel'
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
		});

		it('rejects a paid plan with no stripePriceId configured', async () => {
			mockSubscriptionModel.findById.mockResolvedValue({
				...plan,
				stripePriceId: undefined,
			});

			await expect(
				service.createCheckoutSession(
					'user_1',
					'plan_1',
					'https://ok',
					'https://cancel'
				)
			).rejects.toThrow(BadRequestException);

			expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled();
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
				body.cancelUrl,
				undefined
			);
		});

		it('should pass billingInterval through to the service', async () => {
			const body = {
				userId: 'user1',
				successUrl: 'http://success.url',
				cancelUrl: 'http://cancel.url',
				billingInterval: 'annual' as const,
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
				body.cancelUrl,
				'annual'
			);
		});
	});
});
