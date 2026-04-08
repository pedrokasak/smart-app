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
			{ PETR4: 'stock' },
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
			{ PETR4: 'stock' },
		);

		expect(drivers[0].estimatedTax).toBe(0);
		expect(drivers[0].reason).toContain('isenção');
	});
});
