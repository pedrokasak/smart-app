import { OpportunityRadarService } from 'src/intelligence/application/opportunity-radar.service';
import {
	MarketAssetSnapshot,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

describe('OpportunityRadarService', () => {
	const makeSnapshot = (
		symbol: string,
		overrides: Partial<MarketAssetSnapshot> = {}
	): MarketAssetSnapshot => ({
		symbol,
		assetType: 'stock',
		sector: 'FINANCIAL',
		price: 20,
		dividendYield: 0.07,
		performance: { changePercent: -3 },
		fundamentals: {
			priceToEarnings: 8,
			priceToBook: 1.2,
			returnOnEquity: 0.15,
			netMargin: 0.1,
			evEbitda: 4,
			marketCap: 1000,
		},
		metadata: {
			source: 'primary',
			fallbackUsed: false,
			partial: false,
			fallbackSources: [],
		},
		...overrides,
	});

	const portfolioPositions: PortfolioIntelligencePosition[] = [
		{
			symbol: 'ITUB4',
			assetType: 'stock',
			quantity: 10,
			totalValue: 1000,
			sector: 'FINANCIAL',
		},
		{
			symbol: 'XPLG11',
			assetType: 'fii',
			quantity: 10,
			totalValue: 1000,
			sector: 'REAL_ESTATE',
		},
	];

	it('detects attractive range opportunity', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([makeSnapshot('BBAS3')]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['BBAS3'],
		});

		expect(output.opportunities).toHaveLength(1);
		expect(output.opportunities[0].symbol).toBe('BBAS3');
		expect(output.opportunities[0].rationale.signals).toEqual(
			expect.arrayContaining(['valuation_price_to_earnings_attractive'])
		);
		expect(output.signals.some((item) => item.kind === 'opportunity')).toBe(true);
	});

	it('detects underallocated sector and rebalance signal', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('WEGE3', { sector: 'INDUSTRIAL' }),
			]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['WEGE3'],
			sectorTargetAllocation: {
				INDUSTRIAL: 20,
			},
		});

		expect(output.underallocatedSectors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sector: 'INDUSTRIAL',
				}),
			])
		);
		expect(output.signals.some((item) => item.kind === 'rebalance')).toBe(true);
	});

	it('handles partial data safely', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('ABCD3', {
					sector: null,
					price: null,
					dividendYield: null,
					performance: { changePercent: null },
					fundamentals: {
						priceToEarnings: null,
						priceToBook: null,
						returnOnEquity: null,
						netMargin: null,
						evEbitda: null,
						marketCap: null,
					},
					metadata: {
						source: 'primary',
						fallbackUsed: false,
						partial: true,
						fallbackSources: [],
					},
				}),
			]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['ABCD3'],
			watchlistSymbols: ['ABCD3'],
		});

		expect(output.warnings).toEqual(expect.arrayContaining(['partial_data:ABCD3']));
		expect(output.opportunities[0].dataQuality.partial).toBe(true);
	});

	it('keeps fallback provider metadata and warning', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('VALE3', {
					metadata: {
						source: 'fallback_fundamentus',
						fallbackUsed: true,
						partial: true,
						fallbackSources: ['fundamentus'],
					},
				}),
			]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['VALE3'],
		});

		expect(output.warnings).toEqual(expect.arrayContaining(['fallback_data:VALE3']));
		expect(output.opportunities[0].dataQuality.fallbackUsed).toBe(true);
	});

	it('prioritizes and limits competing signals by configured context', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([
				makeSnapshot('BBAS3', { sector: 'FINANCIAL' }),
				makeSnapshot('PETR4', { sector: 'ENERGY' }),
				makeSnapshot('WEGE3', { sector: 'INDUSTRIAL' }),
			]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['BBAS3', 'PETR4', 'WEGE3'],
			watchlistSymbols: ['PETR4'],
			sectorTargetAllocation: { INDUSTRIAL: 20, ENERGY: 20 },
			rules: {
				maxSignalsTotal: 3,
				maxSignalsPerKind: {
					opportunity: 1,
					rebalance: 1,
					fiscal: 1,
					risk: 1,
				},
			},
			fiscalContext: {
				hasCompensableLoss: true,
			},
		});

		expect(output.signals.length).toBeLessThanOrEqual(3);
		expect(output.signals.filter((item) => item.kind === 'opportunity').length).toBeLessThanOrEqual(1);
		expect(output.signals.filter((item) => item.kind === 'rebalance').length).toBeLessThanOrEqual(1);
		expect(output.signals.filter((item) => item.kind === 'fiscal').length).toBeLessThanOrEqual(1);
	});

	it('returns warning when no relevant signals are found', async () => {
		const marketDataProvider: MarketDataProviderPort = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn().mockResolvedValue([]),
		};
		const service = new OpportunityRadarService(
			marketDataProvider,
			new PortfolioIntelligenceService()
		);

		const output = await service.detect({
			portfolioPositions,
			candidateSymbols: ['NOPE3'],
		});

		expect(output.signals).toEqual([]);
		expect(output.warnings).toEqual(
			expect.arrayContaining(['opportunity_radar_no_relevant_signals'])
		);
	});
});
