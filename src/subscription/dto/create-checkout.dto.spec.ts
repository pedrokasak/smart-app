import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
	const base = {
		userId: 'user_1',
		successUrl: 'https://ok',
		cancelUrl: 'https://cancel',
	};

	it('accepts a valid payload without billingInterval', async () => {
		const dto = plainToInstance(CreateCheckoutDto, { ...base });
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('accepts billingInterval "monthly"', async () => {
		const dto = plainToInstance(CreateCheckoutDto, {
			...base,
			billingInterval: 'monthly',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('accepts billingInterval "annual"', async () => {
		const dto = plainToInstance(CreateCheckoutDto, {
			...base,
			billingInterval: 'annual',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('rejects billingInterval with wrong case ("Annual")', async () => {
		const dto = plainToInstance(CreateCheckoutDto, {
			...base,
			billingInterval: 'Annual',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.property === 'billingInterval')).toBe(true);
	});

	it('rejects billingInterval with wrong value ("yearly")', async () => {
		const dto = plainToInstance(CreateCheckoutDto, {
			...base,
			billingInterval: 'yearly',
		});
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.property === 'billingInterval')).toBe(true);
	});

	it('rejects a missing userId', async () => {
		const dto = plainToInstance(CreateCheckoutDto, {
			successUrl: 'https://ok',
			cancelUrl: 'https://cancel',
		});
		const errors = await validate(dto);
		expect(errors.some((e) => e.property === 'userId')).toBe(true);
	});
});
