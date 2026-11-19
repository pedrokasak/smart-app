import { applyBuy, applySell, averageCost } from './cost-basis';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import { TaxEngineCalculator } from 'src/fiscal/tax-engine/domain/tax-engine.calculator';

describe('cost basis (TRA-232)', () => {
	it('partial sale keeps the average price and the quantity left', () => {
		const bought = applyBuy({ quantity: 0, totalCost: 0 }, 100, 10);
		const { position, costBasis } = applySell(bought, 50);

		expect(position).toEqual({ quantity: 50, totalCost: 500 });
		expect(costBasis).toBe(500);
		expect(averageCost(position)).toBe(10);
	});

	it('buy after a partial sale averages with what was left', () => {
		let position = applyBuy({ quantity: 0, totalCost: 0 }, 100, 10);
		position = applySell(position, 50).position;
		position = applyBuy(position, 50, 20);

		expect(averageCost(position)).toBe(15);
		expect(position.quantity).toBe(100);
	});

	it('fees go into the cost on buys only', () => {
		const position = applyBuy({ quantity: 0, totalCost: 0 }, 10, 10, 5);
		expect(averageCost(position)).toBeCloseTo(10.5, 6);
	});

	it('selling everything or more zeroes the position', () => {
		const bought = applyBuy({ quantity: 0, totalCost: 0 }, 10, 10);

		expect(applySell(bought, 10).position).toEqual({
			quantity: 0,
			totalCost: 0,
		});
		expect(applySell(bought, 15)).toEqual({
			position: { quantity: 0, totalCost: 0 },
			costBasis: 100,
		});
	});

	it('portfolio average price and tax engine agree on the same trades', () => {
		const day = (d: number) => new Date(2026, 0, d);
		const portfolio = new AveragePriceService().calculate([
			{
				assetSymbol: 'PETR4',
				side: 'buy',
				quantity: 100,
				price: 10,
				date: day(1),
			},
			{
				assetSymbol: 'PETR4',
				side: 'sell',
				quantity: 50,
				price: 12,
				date: day(2),
			},
			{
				assetSymbol: 'PETR4',
				side: 'buy',
				quantity: 50,
				price: 20,
				date: day(3),
			},
		]);
		const tax = new TaxEngineCalculator().evaluateOperations([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'buy',
				quantity: 100,
				unitPrice: 10,
				date: day(1),
			},
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'sell',
				quantity: 50,
				unitPrice: 12,
				date: day(2),
			},
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'buy',
				quantity: 50,
				unitPrice: 20,
				date: day(3),
			},
		] as any);

		expect(portfolio).toEqual({ quantity: 100, averagePrice: 15 });
		expect(tax.positions[0]).toMatchObject({ quantity: 100, averagePrice: 15 });
	});
});
