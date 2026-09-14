import { FiscalService } from 'src/fiscal/fiscal.service';

describe('FiscalService', () => {
	const service = new FiscalService({
		calculate: jest.fn(),
	} as any);

	it('keeps requested quantity when within current position', () => {
		const result = service.normalizeSellQuantity(5, 10);
		expect(result.effectiveQuantity).toBe(5);
		expect(result.warning).toBeNull();
	});

	it('clamps requested quantity when above current position', () => {
		const result = service.normalizeSellQuantity(100, 8);
		expect(result.effectiveQuantity).toBe(8);
		expect(result.warning).toContain('Simulação ajustada');
	});

	it('returns zero when requested or current quantity is invalid', () => {
		expect(service.normalizeSellQuantity(0, 10).effectiveQuantity).toBe(0);
		expect(service.normalizeSellQuantity(10, 0).effectiveQuantity).toBe(0);
	});

	it('explains tax drivers by symbol when stock monthly sales exceed exemption', () => {
		const drivers = service.calculateTaxDrivers(
			[
				{
					assetSymbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 10,
					fees: 0,
					date: new Date('2026-01-01T00:00:00.000Z'),
				},
				{
					assetSymbol: 'PETR4',
					side: 'sell',
					quantity: 100,
					price: 250,
					fees: 0,
					date: new Date('2026-01-20T00:00:00.000Z'),
				},
			],
			{ PETR4: 'stock' }
		);

		expect(drivers[0].symbol).toBe('PETR4');
		expect(drivers[0].estimatedTax).toBeGreaterThan(0);
		expect(drivers[0].reason).toContain('tributável');
	});

	it('keeps estimated tax as zero for stock sells under monthly exemption', () => {
		const drivers = service.calculateTaxDrivers(
			[
				{
					assetSymbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 10,
					fees: 0,
					date: new Date('2026-01-01T00:00:00.000Z'),
				},
				{
					assetSymbol: 'PETR4',
					side: 'sell',
					quantity: 10,
					price: 50,
					fees: 0,
					date: new Date('2026-01-20T00:00:00.000Z'),
				},
			],
			{ PETR4: 'stock' }
		);

		expect(drivers[0].estimatedTax).toBe(0);
		expect(drivers[0].reason).toContain('isenção');
	});
	describe('calculateMonthlyTaxSummary', () => {
		const trade = (
			side: 'buy' | 'sell',
			quantity: number,
			price: number,
			date: string,
			assetSymbol = 'PETR4'
		) => ({
			assetSymbol,
			side,
			quantity,
			price,
			fees: 0,
			date: new Date(date),
		});

		it('compensates a previous stock loss before taxing and reports the breakdown', () => {
			const [loss, gain] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 1000, 50, '2026-01-02T12:00:00Z'),
					trade('sell', 500, 44, '2026-01-10T12:00:00Z'), // -3.000, vendas 22.000
					trade('sell', 500, 60, '2026-02-10T12:00:00Z'), // +5.000, vendas 30.000
				],
				{ PETR4: 'stock' }
			);

			expect(loss).toMatchObject({ stockTax: 0, accumulatedLoss: 3000 });
			expect(gain).toMatchObject({
				stockCompensatedLoss: 3000,
				stockTaxableBase: 2000,
				stockTax: 300,
				accumulatedLoss: 0,
			});
		});

		it('keeps the carried loss when the gain happens in an exempt month', () => {
			const [, exemptGain] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 1000, 50, '2026-01-02T12:00:00Z'),
					trade('sell', 500, 44, '2026-01-10T12:00:00Z'), // -3.000
					trade('sell', 100, 60, '2026-02-10T12:00:00Z'), // +1.000, vendas 6.000
				],
				{ PETR4: 'stock' }
			);

			expect(exemptGain).toMatchObject({
				stockExempt: true,
				stockTax: 0,
				stockCompensatedLoss: 0,
				accumulatedLoss: 3000,
			});
		});

		it('exempts crypto gains when monthly crypto sales stay under R$ 35 mil', () => {
			const [under, over] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 2, 20000, '2026-01-02T12:00:00Z', 'BTC'),
					trade('sell', 1, 30000, '2026-01-10T12:00:00Z', 'BTC'),
					trade('sell', 1, 40000, '2026-02-10T12:00:00Z', 'BTC'),
				],
				{ BTC: 'crypto' }
			);

			expect(under).toMatchObject({
				cryptoSales: 30000,
				cryptoExempt: true,
				cryptoTax: 0,
			});
			expect(over).toMatchObject({
				cryptoSales: 40000,
				cryptoExempt: false,
				cryptoTax: 3000,
			});
		});
	});
});
