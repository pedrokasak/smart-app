import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSubscriptionDto } from './create-subscription.dto';

describe('CreateSubscriptionDto', () => {
	it('accepts annualPrice and annualStripePriceId as optional fields', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Investidor Pro',
			price: 49,
			interval: 'month',
			annualPrice: 411.6,
			annualStripePriceId: 'price_annual_123',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('still validates with no annual fields (backward compatible)', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Investidor Pro',
			price: 49,
			interval: 'month',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('rejects a non-numeric annualPrice', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Investidor Pro',
			price: 49,
			interval: 'month',
			annualPrice: 'not-a-number',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.property === 'annualPrice')).toBe(true);
	});

	it('accepts isFeatured and isComingSoon as booleans', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Plano',
			price: 10,
			interval: 'month',
			isFeatured: true,
			isComingSoon: false,
		});

		const errors = await validate(dto);

		expect(errors).toHaveLength(0);
	});

	it('rejects non-boolean isFeatured', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Plano',
			price: 10,
			interval: 'month',
			isFeatured: 'sim',
		});

		const errors = await validate(dto);

		expect(errors.some((error) => error.property === 'isFeatured')).toBe(true);
	});
});
