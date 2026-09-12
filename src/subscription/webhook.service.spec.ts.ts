import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from 'src/subscription/webhooks.controller';
import { WebhooksService } from 'src/subscription/webhooks.service';

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
