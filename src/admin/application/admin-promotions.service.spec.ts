import { BadRequestException } from '@nestjs/common';
import type { StripeService } from 'src/subscription/stripe.service';
import { AdminPromotionsService } from './admin-promotions.service';

const promotion = {
	id: 'promo_1',
	code: 'BLACK30',
	active: true,
	times_redeemed: 4,
	max_redemptions: 100,
	expires_at: 1798761600,
	coupon: {
		percent_off: 30,
		amount_off: null,
		duration: 'repeating',
		duration_in_months: 3,
	},
};

describe('AdminPromotionsService (TRA-182)', () => {
	const stripe = {
		createPromotion: jest.fn(async () => promotion),
		listPromotions: jest.fn(async () => [promotion]),
		deactivatePromotion: jest.fn(async () => ({ ...promotion, active: false })),
	};
	const service = new AdminPromotionsService(
		stripe as unknown as StripeService
	);

	afterEach(() => jest.clearAllMocks());

	it('creates a percent coupon and returns a view with redemptions', async () => {
		const view = await service.create(
			{
				code: 'BLACK30',
				percentOff: 30,
				duration: 'repeating',
				durationInMonths: 3,
				maxRedemptions: 100,
			} as any,
			'admin-1'
		);

		expect(stripe.createPromotion).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'BLACK30',
				percentOff: 30,
				amountOffCents: undefined,
			})
		);
		expect(view).toEqual({
			id: 'promo_1',
			code: 'BLACK30',
			percentOff: 30,
			amountOff: null,
			duration: 'repeating',
			durationInMonths: 3,
			timesRedeemed: 4,
			maxRedemptions: 100,
			expiresAt: new Date(1798761600 * 1000).toISOString(),
			active: true,
		});
	});

	it('fixed amount goes to Stripe in cents', async () => {
		await service.create(
			{ code: 'DEZ', amountOff: 10.5, duration: 'once' } as any,
			'admin-1'
		);
		expect(
			(stripe.createPromotion.mock.calls[0] as unknown[])[0]
		).toMatchObject({
			amountOffCents: 1050,
		});
	});

	it('rejects both or neither discount', async () => {
		await expect(
			service.create(
				{ code: 'X1X', percentOff: 10, amountOff: 5, duration: 'once' } as any,
				'a'
			)
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.create({ code: 'X1X', duration: 'once' } as any, 'a')
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('lists and deactivates', async () => {
		expect((await service.list())[0].timesRedeemed).toBe(4);
		expect((await service.deactivate('promo_1', 'admin-1')).active).toBe(false);
	});
});
