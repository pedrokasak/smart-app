import {
	ChargeSnapshot,
	REFUND_WINDOW_DAYS,
	evaluateRefund,
} from './refund-policy';

const DAY = 24 * 60 * 60;
const now = new Date('2026-10-22T12:00:00Z');
const nowSec = now.getTime() / 1000;

function charge(overrides: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
	return {
		id: 'ch_1',
		amount: 1990,
		currency: 'brl',
		created: nowSec - 2 * DAY,
		succeeded: true,
		amountRefunded: 0,
		...overrides,
	};
}

describe('evaluateRefund', () => {
	it('libera a primeira cobrança dentro da janela', () => {
		const decision = evaluateRefund([charge()], now);

		expect(decision).toMatchObject({
			eligible: true,
			chargeId: 'ch_1',
			amount: 1990,
			currency: 'brl',
		});
		if (decision.eligible) {
			expect(decision.deadline.getTime()).toBe(
				(nowSec - 2 * DAY + REFUND_WINDOW_DAYS * DAY) * 1000
			);
		}
	});

	it('vale até o último instante da janela e nega logo depois', () => {
		const onEdge = charge({ created: nowSec - REFUND_WINDOW_DAYS * DAY });
		const late = charge({ created: nowSec - REFUND_WINDOW_DAYS * DAY - 1 });

		expect(evaluateRefund([onEdge], now).eligible).toBe(true);
		expect(evaluateRefund([late], now)).toEqual({
			eligible: false,
			reason: 'window_expired',
		});
	});

	it('sem cobrança bem-sucedida (teste grátis, boleto pendente) não há o que estornar', () => {
		expect(evaluateRefund([], now)).toEqual({
			eligible: false,
			reason: 'no_charge',
		});
		expect(evaluateRefund([charge({ succeeded: false })], now)).toEqual({
			eligible: false,
			reason: 'no_charge',
		});
	});

	it('cobrança já estornada bloqueia, inclusive numa compra posterior', () => {
		const refunded = charge({ id: 'ch_old', amountRefunded: 1990 });
		const repurchase = charge({ id: 'ch_new', created: nowSec - DAY });

		expect(evaluateRefund([refunded], now)).toEqual({
			eligible: false,
			reason: 'already_refunded',
		});
		expect(evaluateRefund([repurchase, refunded], now)).toEqual({
			eligible: false,
			reason: 'already_refunded',
		});
	});

	it('renovação não é primeira compra, mesmo dentro dos 7 dias', () => {
		const first = charge({ id: 'ch_a', created: nowSec - 30 * DAY });
		const renewal = charge({ id: 'ch_b', created: nowSec - DAY });

		expect(evaluateRefund([renewal, first], now)).toEqual({
			eligible: false,
			reason: 'not_first_charge',
		});
	});

	it('ignora tentativas de cobrança que falharam', () => {
		const failed = charge({ id: 'ch_fail', succeeded: false });

		expect(evaluateRefund([failed, charge()], now).eligible).toBe(true);
	});
});
