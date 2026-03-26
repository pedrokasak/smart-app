import { SimulateSaleImpactUseCase } from 'src/fiscal/tax-engine/application/simulate-sale-impact.use-case';
import { SimulateSellUseCase } from 'src/fiscal/tax-engine/application/simulate-sell.use-case';

describe('SimulateSaleImpactUseCase', () => {
	const makeUseCase = () => new SimulateSaleImpactUseCase(new SimulateSellUseCase());

	it('supports partial sell simulation', () => {
		const useCase = makeUseCase();
		const result = useCase.execute({
			symbol: 'VALE3',
			assetType: 'stock',
			quantityToSell: 4,
			sellPrice: 30,
			simulatedSellDate: '2026-03-10',
			currentPosition: {
				quantity: 10,
				totalCost: 200,
			},
		});

		expect(result.averagePrice).toBe(20);
		expect(result.remainingQuantity).toBe(6);
		expect(result.remainingPosition.averagePrice).toBe(20);
	});

	it('supports total sell simulation', () => {
		const useCase = makeUseCase();
		const result = useCase.execute({
			symbol: 'ITUB4',
			assetType: 'stock',
			quantityToSell: 10,
			sellPrice: 30,
			simulatedSellDate: '2026-03-11',
			currentPosition: {
				quantity: 10,
				totalCost: 200,
			},
		});

		expect(result.remainingQuantity).toBe(0);
		expect(result.remainingPosition.totalCost).toBe(0);
	});

	it('estimates tax for profitable sell', () => {
		const useCase = makeUseCase();
		const result = useCase.execute({
			symbol: 'KNCR11',
			assetType: 'fii',
			quantityToSell: 10,
			sellPrice: 120,
			simulatedSellDate: '2026-03-12',
			currentPosition: {
				quantity: 10,
				totalCost: 1000,
			},
		});

		expect(result.realizedPnl).toBe(200);
		expect(result.classification).toBe('tributavel');
		expect(result.estimatedTax).toBe(40);
	});

	it('returns zero estimated tax for loss sell', () => {
		const useCase = makeUseCase();
		const result = useCase.execute({
			symbol: 'HGLG11',
			assetType: 'fii',
			quantityToSell: 10,
			sellPrice: 80,
			simulatedSellDate: '2026-03-13',
			currentPosition: {
				quantity: 10,
				totalCost: 1000,
			},
		});

		expect(result.realizedPnl).toBe(-200);
		expect(result.taxableBaseAfterCompensation).toBe(0);
		expect(result.estimatedTax).toBe(0);
	});

	it('applies compensation before estimating tax', () => {
		const useCase = makeUseCase();
		const result = useCase.execute({
			symbol: 'XPML11',
			assetType: 'fii',
			quantityToSell: 10,
			sellPrice: 120,
			simulatedSellDate: '2026-03-14',
			accumulatedCompensableLoss: 150,
			currentPosition: {
				quantity: 10,
				totalCost: 1000,
			},
		});

		expect(result.realizedPnl).toBe(200);
		expect(result.compensationUsed).toBe(150);
		expect(result.taxableBaseAfterCompensation).toBe(50);
		expect(result.classification).toBe('tributavel_com_compensacao');
		expect(result.estimatedTax).toBe(10);
	});
});

