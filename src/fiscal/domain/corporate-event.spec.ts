import { applyBuy, applyCorporateEvent, averageCost } from './cost-basis';
import { type CorporateEvent, corporateEventError } from './corporate-event';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import { TaxEngineCalculator } from 'src/fiscal/tax-engine/domain/tax-engine.calculator';

const day = (d: number) => new Date(Date.UTC(2026, 0, d));
const event = (overrides: Partial<CorporateEvent>): CorporateEvent => ({
	symbol: 'PETR4',
	type: 'SPLIT',
	ratio: 2,
	exDate: day(10),
	...overrides,
});

describe('corporate events (TRA-231)', () => {
	const hundredAtTen = applyBuy({ quantity: 0, totalCost: 0 }, 100, 10);

	it('split 1:2 doubles the quantity, halves the average and keeps the total cost', () => {
		const position = applyCorporateEvent(hundredAtTen, event({}));

		expect(position).toEqual({ quantity: 200, totalCost: 1000 });
		expect(averageCost(position)).toBe(5);
	});

	it('reverse split 10:1 divides the quantity and keeps the total cost', () => {
		const position = applyCorporateEvent(
			hundredAtTen,
			event({ type: 'REVERSE_SPLIT', ratio: 0.1 })
		);

		expect(position).toEqual({ quantity: 10, totalCost: 1000 });
		expect(averageCost(position)).toBe(100);
	});

	it('bonus adds the new shares and their attributed cost', () => {
		const position = applyCorporateEvent(
			hundredAtTen,
			event({ type: 'BONUS', ratio: 0.1, bonusUnitCost: 4 })
		);

		// 10 ações novas a R$ 4: custo 1.040 em 110 ações.
		expect(position).toEqual({ quantity: 110, totalCost: 1040 });
		expect(averageCost(position)).toBeCloseTo(9.4545, 4);
	});

	it('bonus fractions stay out (the company auctions them)', () => {
		const position = applyCorporateEvent(
			applyBuy({ quantity: 0, totalCost: 0 }, 15, 10),
			event({ type: 'BONUS', ratio: 0.1 })
		);
		expect(position.quantity).toBe(16);
	});

	it('validates the ratio direction', () => {
		expect(corporateEventError(event({ ratio: 0.5 }))).toContain(
			'desdobramento'
		);
		expect(
			corporateEventError(event({ type: 'REVERSE_SPLIT', ratio: 2 }))
		).toContain('grupamento');
		expect(corporateEventError(event({}))).toBeNull();
	});

	describe('AveragePriceService with events', () => {
		const service = new AveragePriceService();

		it('applies the split on the ex date, before same-day trades', () => {
			const result = service.calculate(
				[
					{
						assetSymbol: 'PETR4',
						side: 'buy',
						quantity: 100,
						price: 10,
						date: day(1),
					},
					// Compra na data ex já é "ex": não é desdobrada.
					{
						assetSymbol: 'PETR4',
						side: 'buy',
						quantity: 100,
						price: 5,
						date: day(10),
					},
				],
				[event({})]
			);

			expect(result).toEqual({ quantity: 300, averagePrice: 5 });
		});

		it('applies events after the last trade too', () => {
			const result = service.calculate(
				[
					{
						assetSymbol: 'PETR4',
						side: 'buy',
						quantity: 100,
						price: 10,
						date: day(1),
					},
				],
				[event({ exDate: day(20) })]
			);
			expect(result).toEqual({ quantity: 200, averagePrice: 5 });
		});
	});

	it('tax engine: selling split shares uses the adjusted cost', () => {
		const result = new TaxEngineCalculator().evaluateOperations(
			[
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
					quantity: 150,
					unitPrice: 6,
					date: day(15),
				},
			] as any,
			undefined,
			[event({})]
		);

		// 200 ações a R$ 5; venda de 150 a R$ 6: lucro de R$ 150.
		expect(result.realizedSales[0]).toMatchObject({
			averagePriceAtSale: 5,
			costBasis: 750,
			realizedPnl: 150,
		});
		expect(result.positions[0]).toMatchObject({
			quantity: 50,
			averagePrice: 5,
		});
	});
});
