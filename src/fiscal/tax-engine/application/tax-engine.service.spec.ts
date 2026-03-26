import { CalculateTaxStateUseCase } from 'src/fiscal/tax-engine/application/calculate-tax-state.use-case';
import { SimulateSaleImpactUseCase } from 'src/fiscal/tax-engine/application/simulate-sale-impact.use-case';
import { SimulateSellUseCase } from 'src/fiscal/tax-engine/application/simulate-sell.use-case';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';

describe('TaxEngineService', () => {
	it('evaluates operations through use case', () => {
		const service = new TaxEngineService(
			new CalculateTaxStateUseCase(),
			new SimulateSellUseCase(),
			new SimulateSaleImpactUseCase(new SimulateSellUseCase())
		);

		const result = service.evaluateOperations([
			{
				symbol: 'PETR4',
				assetType: 'stock',
				side: 'buy',
				quantity: 10,
				unitPrice: 20,
			},
		]);

		expect(result.positions[0].averagePrice).toBe(20);
	});

	it('simulates partial sell through use case', () => {
		const service = new TaxEngineService(
			new CalculateTaxStateUseCase(),
			new SimulateSellUseCase(),
			new SimulateSaleImpactUseCase(new SimulateSellUseCase())
		);

		const result = service.simulateSell({
			symbol: 'VALE3',
			assetType: 'stock',
			quantityToSell: 4,
			sellPrice: 30,
			currentPosition: {
				quantity: 10,
				totalCost: 200,
			},
		});

		expect(result.averagePriceAtSale).toBe(20);
		expect(result.remainingPosition.quantity).toBe(6);
	});

	it('simulates sale impact with estimated tax through use case', () => {
		const service = new TaxEngineService(
			new CalculateTaxStateUseCase(),
			new SimulateSellUseCase(),
			new SimulateSaleImpactUseCase(new SimulateSellUseCase())
		);

		const result = service.simulateSaleImpact({
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
		expect(result.estimatedTax).toBe(40);
		expect(result.classification).toBe('tributavel');
	});
});
