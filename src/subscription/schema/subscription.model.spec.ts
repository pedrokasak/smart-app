import { SubscriptionModel } from './subscription.model';

describe('SubscriptionModel', () => {
	it('validates a document with annualPrice and annualStripePriceId set', () => {
		const doc = new SubscriptionModel({
			name: 'Investidor Pro',
			price: 49,
			interval: 'month',
			stripePriceId: 'price_monthly_123',
			annualPrice: 411.6,
			annualStripePriceId: 'price_annual_123',
		});
		const error = doc.validateSync();
		expect(error).toBeUndefined();
		expect(doc.annualPrice).toBe(411.6);
		expect(doc.annualStripePriceId).toBe('price_annual_123');
	});

	it('validates a document with no annual fields set (backward compatible)', () => {
		const doc = new SubscriptionModel({
			name: 'Investidor Pro',
			price: 49,
			interval: 'month',
			stripePriceId: 'price_monthly_123',
		});
		const error = doc.validateSync();
		expect(error).toBeUndefined();
		expect(doc.annualPrice).toBeUndefined();
		expect(doc.annualStripePriceId).toBeUndefined();
	});
});
