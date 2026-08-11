import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PurchaseIntentDto } from './purchase-intent.dto';

describe('PurchaseIntentDto', () => {
	it('passes validation with a valid email and plan name', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planName: 'Premium',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('fails validation with an invalid email', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'not-an-email',
			planName: 'Premium',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].property).toBe('email');
	});

	it('fails validation with an empty plan name', async () => {
		const dto = plainToInstance(PurchaseIntentDto, {
			email: 'investidor@example.com',
			planName: '',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].property).toBe('planName');
	});
});
