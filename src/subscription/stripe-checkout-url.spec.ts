import { withCheckoutSessionId } from './stripe.service';

/** Incidente 27/09/2026: o retorno do checkout chegava sem `session_id`. */
describe('withCheckoutSessionId', () => {
	it('acrescenta o placeholder literal do Stripe', () => {
		expect(
			withCheckoutSessionId('https://trackerr.com.br/subscription-success')
		).toBe(
			'https://trackerr.com.br/subscription-success?session_id={CHECKOUT_SESSION_ID}'
		);
	});

	it('preserva query string existente', () => {
		expect(withCheckoutSessionId('https://trackerr.com.br/ok?from=plans')).toBe(
			'https://trackerr.com.br/ok?from=plans&session_id={CHECKOUT_SESSION_ID}'
		);
	});

	it('não duplica quando o web já manda o placeholder', () => {
		const url = 'https://trackerr.com.br/ok?session_id={CHECKOUT_SESSION_ID}';
		expect(withCheckoutSessionId(url)).toBe(url);
	});
});
