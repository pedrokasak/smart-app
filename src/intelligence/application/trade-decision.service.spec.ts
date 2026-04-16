import { TradeDecisionService } from 'src/intelligence/application/trade-decision.service';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';

describe('TradeDecisionService', () => {
	const taxEngineServiceMock = {
		simulateSaleImpact: jest.fn(),
	} as unknown as TaxEngineService;

	beforeEach(() => jest.clearAllMocks());

	it('returns degraded output for invalid inputs', () => {
		const service = new TradeDecisionService(taxEngineServiceMock);
		const result = service.buildPreAndPostTrade({
			symbol: 'PETR4',
			assetType: 'stock',
			quantityToSell: 0,
			sellPrice: 0,
			simulatedSellDate: new Date().toISOString(),
			currentPosition: { quantity: 10, totalCost: 1000 },
			totalPortfolioValue: 10000,
		});
		expect(result.status).toBe('degraded');
		expect(result.warnings).toContain('trade_decision_invalid_inputs');
	});

	it('builds pre and post trade one-click output deterministically', () => {
		(taxEngineServiceMock.simulateSaleImpact as jest.Mock).mockReturnValue({
			estimatedTax: 150,
			taxRateApplied: 0.15,
			classification: 'tributavel',
			monthlyExemptionApplied: false,
			remainingQuantity: 5,
			realizedPnl: 1000,
			compensationUsed: 0,
		});
		const service = new TradeDecisionService(taxEngineServiceMock);
		const result = service.buildPreAndPostTrade({
			symbol: 'PETR4',
			assetType: 'stock',
			quantityToSell: 5,
			sellPrice: 30,
			simulatedSellDate: new Date().toISOString(),
			currentPosition: { quantity: 10, totalCost: 200 },
			totalPortfolioValue: 2000,
		});

		expect(result.status).toBe('ok');
		expect(result.preTrade.estimatedTax).toBe(150);
		expect(result.postTrade.estimatedDarf).toBe(150);
		expect(result.preTrade.alternatives).toHaveLength(3);
		expect(result.postTrade.portfolioImpactPercent).toBeLessThan(0);
	});
});
