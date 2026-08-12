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

	it('defaults isFeatured and isComingSoon to false', () => {
		const doc = new SubscriptionModel({
			name: 'Plano Teste',
			price: 10,
			currency: 'brl',
			interval: 'month',
			intervalCount: 1,
		});

		expect(doc.isFeatured).toBe(false);
		expect(doc.isComingSoon).toBe(false);
	});

	it('accepts isFeatured and isComingSoon when provided', () => {
		const doc = new SubscriptionModel({
			name: 'Plano Destaque',
			price: 10,
			currency: 'brl',
			interval: 'month',
			intervalCount: 1,
			isFeatured: true,
			isComingSoon: true,
		});

		expect(doc.isFeatured).toBe(true);
		expect(doc.isComingSoon).toBe(true);
	});
});
