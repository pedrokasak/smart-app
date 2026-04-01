import { TaxEngineCalculator } from 'src/fiscal/tax-engine/domain/tax-engine.calculator';

describe('TaxEngineCalculator', () => {
	it('handles single buy and calculates average price', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 20,
				fees: 0,
			},
		]);

		expect(result.positions).toHaveLength(1);
		expect(result.positions[0]).toMatchObject({
			symbol: 'PETR4',
			quantity: 10,
			totalCost: 200,
			averagePrice: 20,
		});
	});

	it('calculates weighted average price with multiple buys', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'VALE3',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 10,
				fees: 0,
			},
			{
				symbol: 'VALE3',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 20,
				fees: 0,
			},
		]);

		expect(result.positions[0].quantity).toBe(20);
		expect(result.positions[0].averagePrice).toBe(15);
	});

	it('supports partial sell and keeps remaining position with same average price', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'BBAS3',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 20,
				fees: 0,
			},
			{
				symbol: 'BBAS3',
				assetType: 'stock',
				side: 'sell',
				quantity: 4,
				unitPrice: 22,
				fees: 0,
			},
		]);

		expect(result.realizedSales).toHaveLength(1);
		expect(result.positions[0]).toMatchObject({
			symbol: 'BBAS3',
			quantity: 6,
			averagePrice: 20,
		});
	});

	it('supports total sell and clears remaining position', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				side: 'buy',
				quantity: 5,
				unitPrice: 30,
				fees: 0,
			},
			{
				symbol: 'ITUB4',
				assetType: 'stock',
				side: 'sell',
				quantity: 5,
				unitPrice: 35,
				fees: 0,
			},
		]);

		expect(result.positions).toEqual([]);
		expect(result.realizedSales[0].remainingPosition.quantity).toBe(0);
		expect(result.realizedSales[0].remainingPosition.averagePrice).toBe(0);
	});

	it('calculates realized profit on sell', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 10,
				fees: 0,
			},
			{
				symbol: 'WEGE3',
				assetType: 'stock',
				side: 'sell',
				quantity: 10,
				unitPrice: 15,
				fees: 0,
			},
		]);

		expect(result.realizedSales[0].realizedPnl).toBe(50);
		expect(result.realizedSales[0].classification).toBe('isento');
		expect(result.aggregates.realizedProfit).toBe(50);
		expect(result.aggregates.realizedLoss).toBe(0);
	});

	it('calculates realized loss and prepares loss compensation base', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'HGLG11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 20,
				fees: 0,
			},
			{
				symbol: 'HGLG11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 15,
				fees: 0,
			},
		]);

		expect(result.realizedSales[0].realizedPnl).toBe(-50);
		expect(result.realizedSales[0].classification).toBe('tributavel');
		expect(result.aggregates.realizedLoss).toBe(50);
		expect(result.lossCompensationBase.accumulatedLossByAssetType.fii).toBe(50);
		expect(result.lossCompensationBase.totalAccumulatedLoss).toBe(50);
	});

	it('classifies as taxable when there is profit without compensation', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'KNCR11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 100,
				date: '2026-01-02',
			},
			{
				symbol: 'KNCR11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 120,
				date: '2026-01-20',
			},
		]);

		expect(result.realizedSales[0].classification).toBe('tributavel');
		expect(result.realizedSales[0].compensationUsed).toBe(0);
		expect(result.realizedSales[0].taxableBaseAfterCompensation).toBe(200);
	});

	it('applies accumulated loss compensation on future taxable gain', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'XPML11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 100,
				date: '2026-01-02',
			},
			{
				symbol: 'XPML11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 80,
				date: '2026-01-25',
			},
			{
				symbol: 'XPML11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 100,
				date: '2026-02-02',
			},
			{
				symbol: 'XPML11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 130,
				date: '2026-02-20',
			},
		]);

		expect(result.realizedSales[1].classification).toBe(
			'tributavel_com_compensacao'
		);
		expect(result.realizedSales[1].compensationUsed).toBe(200);
		expect(result.realizedSales[1].taxableBaseAfterCompensation).toBe(100);
		expect(result.lossCompensationBase.accumulatedLossByAssetType.fii).toBe(0);
	});

	it('applies monthly stock exemption when gross sales stay below threshold', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'ABEV3',
				assetType: 'stock',
				side: 'buy',
				quantity: 100,
				unitPrice: 10,
				date: '2026-03-01',
			},
			{
				symbol: 'ABEV3',
				assetType: 'stock',
				side: 'sell',
				quantity: 100,
				unitPrice: 15,
				date: '2026-03-15',
			},
		]);

		expect(result.realizedSales[0].stockMonthlyGrossSales).toBe(1500);
		expect(result.realizedSales[0].monthlyExemptionApplied).toBe(true);
		expect(result.realizedSales[0].classification).toBe('isento');
		expect(result.realizedSales[0].taxableBaseAfterCompensation).toBe(0);
	});

	it('does not apply monthly stock exemption when gross sales exceed threshold', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'buy',
				quantity: 1000,
				unitPrice: 20,
				date: '2026-04-01',
			},
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'sell',
				quantity: 1000,
				unitPrice: 30,
				date: '2026-04-20',
			},
		]);

		expect(result.realizedSales[0].stockMonthlyGrossSales).toBe(30000);
		expect(result.realizedSales[0].monthlyExemptionApplied).toBe(false);
		expect(result.realizedSales[0].classification).toBe('tributavel');
		expect(result.realizedSales[0].taxableBaseAfterCompensation).toBe(10000);
	});

	it('zeros taxable base when compensation fully offsets gain', () => {
		const calculator = new TaxEngineCalculator();
		const result = calculator.evaluateOperations([
			{
				symbol: 'BRCR11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 100,
				date: '2026-01-02',
			},
			{
				symbol: 'BRCR11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 80,
				date: '2026-01-20',
			},
			{
				symbol: 'BRCR11',
				assetType: 'fii',
				side: 'buy',
				quantity: 10,
				unitPrice: 100,
				date: '2026-02-03',
			},
			{
				symbol: 'BRCR11',
				assetType: 'fii',
				side: 'sell',
				quantity: 10,
				unitPrice: 120,
				date: '2026-02-25',
			},
		]);

		expect(result.realizedSales[1].classification).toBe(
			'tributavel_com_compensacao'
		);
		expect(result.realizedSales[1].compensationUsed).toBe(200);
		expect(result.realizedSales[1].taxableBaseAfterCompensation).toBe(0);
	});
});
