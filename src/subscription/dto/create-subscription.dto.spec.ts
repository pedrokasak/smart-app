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

	// TRA-189: sem esta validação, um typo em `capabilities` (ex.:
	// 'broker_sync' em vez de 'broker.sync') era aceito silenciosamente e
	// revogava o acesso a TODAS as capabilities do plano — a lista deixa de
	// estar vazia e o fallback por accessLevel para de valer, sem nenhum erro
	// de validação avisando o admin.
	it('accepts known capability keys', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Plano',
			price: 10,
			interval: 'month',
			capabilities: ['fiscal.ir_report', 'broker.sync'],
		});

		const errors = await validate(dto);

		expect(errors).toHaveLength(0);
	});

	describe('quotas (TRA-197)', () => {
		const base = { name: 'Plano', price: 10, interval: 'month' };

		it('aceita limites inteiros, zero e null (ilimitado)', async () => {
			const dto = plainToInstance(CreateSubscriptionDto, {
				...base,
				quotas: { assets: 10, portfolios: 0, broker_connections: null },
			});

			expect(await validate(dto)).toHaveLength(0);
			expect(dto.quotas?.broker_connections).toBeNull();
		});

		it('aceita informar só um recurso', async () => {
			const dto = plainToInstance(CreateSubscriptionDto, {
				...base,
				quotas: { assets: 25 },
			});

			expect(await validate(dto)).toHaveLength(0);
		});

		it.each([
			['negativo', { assets: -1 }],
			['fracionado', { portfolios: 1.5 }],
			['texto', { broker_connections: 'muitos' }],
		])('recusa limite %s', async (_label, quotas) => {
			const dto = plainToInstance(CreateSubscriptionDto, { ...base, quotas });

			const errors = await validate(dto);

			expect(errors.some((error) => error.property === 'quotas')).toBe(true);
		});
	});

	it('rejects an unknown capability key', async () => {
		const dto = plainToInstance(CreateSubscriptionDto, {
			name: 'Plano',
			price: 10,
			interval: 'month',
			capabilities: ['broker_sync'],
		});

		const errors = await validate(dto);

		expect(errors.some((error) => error.property === 'capabilities')).toBe(
			true
		);
	});
});
