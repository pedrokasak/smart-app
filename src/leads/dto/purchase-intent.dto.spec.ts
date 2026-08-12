import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PurchaseIntentDto } from './purchase-intent.dto';

describe('PurchaseIntentDto', () => {
	it('fails validation with an invalid email', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'not-an-email',
			planId: '6995af0198591333bb0d4862',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].property).toBe('email');
	});

	it('accepts a valid mongo id and no utm fields', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
		});

		const errors = await validate(dto);

		expect(errors).toHaveLength(0);
	});

	it('rejects a planId that is not a mongo id', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planId: 'Premium',
		});

		const errors = await validate(dto);

		expect(errors.some((error) => error.property === 'planId')).toBe(true);
	});

	it('accepts utm fields within the allowed charset', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
			utmSource: 'reddit',
			utmMedium: 'social-organic',
			utmCampaign: 'validacao_2026.08',
		});

		const errors = await validate(dto);

		expect(errors).toHaveLength(0);
	});

	it('rejects a utm value with characters outside the allowed charset', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
			utmSource: '<script>alert(1)</script>',
		});

		const errors = await validate(dto);

		expect(errors.some((error) => error.property === 'utmSource')).toBe(true);
	});

	it('rejects a utm value longer than 64 characters', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
			utmCampaign: 'a'.repeat(65),
		});

		const errors = await validate(dto);

		expect(errors.some((error) => error.property === 'utmCampaign')).toBe(true);
	});
});
