import Stripe from 'stripe';
import { WebhooksController } from 'src/subscription/webhooks.controller';
import { WebhooksService } from 'src/subscription/webhooks.service';

jest.mock('src/env', () => ({
	stripeWebhookSecret: 'whsec_test',
	stripeWebhookSecretProduction: 'whsec_prod',
}));

// Controller instanciado direto (sem DI): o foco e a verificacao de
// assinatura, que precisa acontecer ANTES de qualquer processamento — caso
// contrario o endpoint aceitaria eventos forjados.
describe('WebhooksController — verificação de assinatura', () => {
	let controller: WebhooksController;
	let webhooksService: { handleWebhook: jest.Mock };
	let constructEvent: jest.Mock;

	function makeRes() {
		return { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
	}

	beforeEach(() => {
		webhooksService = { handleWebhook: jest.fn().mockResolvedValue(true) };
		constructEvent = jest.fn();
		const stripe = { webhooks: { constructEvent } } as unknown as Stripe;
		controller = new WebhooksController(
			webhooksService as unknown as WebhooksService,
			stripe
		);
	});

	it('verifies the signature and forwards the CONSTRUCTED event (not the raw body)', async () => {
		const event = { id: 'evt_1', type: 'customer.subscription.created' };
		constructEvent.mockReturnValue(event);
		const req: any = {
			headers: { 'stripe-signature': 'sig_valida' },
			body: Buffer.from('{}'),
		};
		const res = makeRes();

		await controller.handleStripeWebhook(req, res);

		expect(constructEvent).toHaveBeenCalledWith(
			req.body,
			'sig_valida',
			'whsec_test'
		);
		// O evento verificado e passado adiante, nunca o body cru.
		expect(webhooksService.handleWebhook).toHaveBeenCalledWith(event);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ received: true });
	});

	it('rejects an invalid signature with 400 and never processes the event', async () => {
		constructEvent.mockImplementation(() => {
			throw new Error('bad sig');
		});
		const req: any = {
			headers: { 'stripe-signature': 'sig_forjada' },
			body: Buffer.from('{}'),
		};
		const res = makeRes();

		await controller.handleStripeWebhook(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Assinatura inválida' });
		expect(webhooksService.handleWebhook).not.toHaveBeenCalled();
	});

	it('returns 500 when a processing error happens after a valid signature', async () => {
		constructEvent.mockReturnValue({ id: 'evt', type: 'x' });
		webhooksService.handleWebhook.mockRejectedValue(new Error('db down'));
		const req: any = {
			headers: { 'stripe-signature': 'sig_valida' },
			body: Buffer.from('{}'),
		};
		const res = makeRes();

		await controller.handleStripeWebhook(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
	});
});
