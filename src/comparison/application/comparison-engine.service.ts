import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	MarketAssetSnapshot,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	PortfolioFitAnalysisOutput,
	PortfolioIntelligencePosition,
	PortfolioIntelligenceThresholds,
} from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

export interface AssetComparisonResult {
	symbol: string;
	inPortfolio: boolean;
	metrics: {
		price: number | null;
		dividendYield: number | null;
		changePercent: number | null;
		priceToEarnings: number | null;
		priceToBook: number | null;
		returnOnEquity: number | null;
		netMargin: number | null;
		evEbitda: number | null;
		marketCap: number | null;
	};
	fit: {
		score: number;
		status: 'weak' | 'neutral' | 'strong';
		reasons: string[];
		classification: 'bom' | 'neutro' | 'ruim';
		portfolioImpact: {
			alreadyInPortfolio: boolean;
			confidence: 'high' | 'medium' | 'low';
			diversification: PortfolioFitAnalysisOutput['impact']['diversification'];
			concentration: {
				assetPercentageBefore: number;
				assetPercentageAfter: number;
				assetPercentageDelta: number;
				topAssetPercentageBefore: number;
				topAssetPercentageAfter: number;
				topAssetPercentageDelta: number;
			};
			sectorExposure: PortfolioFitAnalysisOutput['impact']['sectorConcentration'];
		};
	};
	dataQuality: {
		partial: boolean;
		fallbackUsed: boolean;
		fallbackSources: string[];
		missingMetrics: string[];
	};
}

type ComparisonMetricKey =
	| 'price'
	| 'changePercent'
	| 'dividendYield'
	| 'priceToEarnings'
	| 'priceToBook'
	| 'returnOnEquity'
	| 'netMargin'
	| 'evEbitda'
	| 'marketCap';

type ComparisonDimension = 'quote' | 'fundamentals' | 'dividends' | 'performance';

export interface ComparisonMetricDimensionRow {
	metric: ComparisonMetricKey;
	preferredDirection: 'higher' | 'lower';
	winnerSymbol: string | null;
	values: Array<{
		symbol: string;
		value: number | null;
		available: boolean;
		inPortfolio: boolean;
	}>;
}

export interface ComparisonEngineOutput {
	executiveSummary: {
		bestDividendSymbol: string | null;
		bestMomentumSymbol: string | null;
		bestValuationSymbol: string | null;
		bestFitSymbol: string | null;
	};
	byDimension: Record<ComparisonDimension, ComparisonMetricDimensionRow[]>;
	results: AssetComparisonResult[];
	unavailableSymbols: string[];
}

@Injectable()
export class ComparisonEngineService {
	constructor(
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketDataProvider: MarketDataProviderPort,
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService
	) {}

	async compareAssets(input: {
		symbols: string[];
		portfolioPositions?: PortfolioIntelligencePosition[];
		thresholds?: Partial<PortfolioIntelligenceThresholds>;
	}): Promise<ComparisonEngineOutput> {
		const uniqueSymbols = Array.from(
			new Set(
				input.symbols
					.map((symbol) => String(symbol || '').trim().toUpperCase())
					.filter(Boolean)
			)
		);

		const snapshots = await this.marketDataProvider.getManyAssetSnapshots(
			uniqueSymbols
		);
		const snapshotMap = new Map<string, MarketAssetSnapshot>(
			snapshots.map((snapshot) => [snapshot.symbol, snapshot])
		);
		const unavailableSymbols = uniqueSymbols.filter(
			(symbol) => !snapshotMap.has(symbol)
		);

		const portfolioPositions = input.portfolioPositions || [];
		const portfolioBySymbol = new Map(
			portfolioPositions.map((position) => [position.symbol.toUpperCase(), position])
		);
		const portfolioAnalysis = this.portfolioIntelligenceService.analyzePositions(
			portfolioPositions,
			input.thresholds
		);

		const results = uniqueSymbols
			.filter((symbol) => snapshotMap.has(symbol))
			.map((symbol) => {
				const snapshot = snapshotMap.get(symbol)!;
				const fit = this.computePortfolioFit(
					snapshot,
					portfolioBySymbol.has(symbol),
					portfolioAnalysis,
					portfolioPositions,
					portfolioBySymbol.get(symbol)
				);

				const metrics = {
					price: snapshot.price,
					dividendYield: snapshot.dividendYield,
					changePercent: snapshot.performance.changePercent,
					priceToEarnings: snapshot.fundamentals.priceToEarnings,
					priceToBook: snapshot.fundamentals.priceToBook,
					returnOnEquity: snapshot.fundamentals.returnOnEquity,
					netMargin: snapshot.fundamentals.netMargin,
					evEbitda: snapshot.fundamentals.evEbitda,
					marketCap: snapshot.fundamentals.marketCap,
				};

				return {
					symbol,
					inPortfolio: portfolioBySymbol.has(symbol),
					metrics,
					fit,
					dataQuality: {
						partial: snapshot.metadata.partial,
						fallbackUsed: snapshot.metadata.fallbackUsed,
						fallbackSources: snapshot.metadata.fallbackSources,
						missingMetrics: Object.entries(metrics)
							.filter(([, value]) => value === null)
							.map(([key]) => key),
					},
				};
			});

		const byDimension = this.buildByDimension(results);

		return {
			executiveSummary: {
				bestDividendSymbol: this.maxBy(results, (item) => item.metrics.dividendYield),
				bestMomentumSymbol: this.maxBy(results, (item) => item.metrics.changePercent),
				bestValuationSymbol: this.minBy(results, (item) => item.metrics.priceToEarnings),
				bestFitSymbol: this.maxBy(results, (item) => item.fit.score),
			},
			byDimension,
			results,
			unavailableSymbols,
		};
	}

	private computePortfolioFit(
		snapshot: MarketAssetSnapshot,
		alreadyOwned: boolean,
		portfolioAnalysis: ReturnType<PortfolioIntelligenceService['analyzePositions']>,
		portfolioPositions: PortfolioIntelligencePosition[],
		currentPosition?: PortfolioIntelligencePosition
	): {
		score: number;
		status: 'weak' | 'neutral' | 'strong';
		reasons: string[];
		classification: 'bom' | 'neutro' | 'ruim';
		portfolioImpact: AssetComparisonResult['fit']['portfolioImpact'];
	} {
		const candidateValue = this.resolveCandidateValue(snapshot, currentPosition);
		const portfolioFit = this.portfolioIntelligenceService.analyzePortfolioFit(
			portfolioPositions,
			{
				symbol: snapshot.symbol,
				assetType: snapshot.assetType,
				quantity: alreadyOwned ? Number(currentPosition?.quantity || 1) : 1,
				totalValue: candidateValue > 0 ? candidateValue : undefined,
				currentPrice: snapshot.price || undefined,
				sector: snapshot.sector,
			}
		);
		const projectedPortfolio = this.mergeCandidateIntoPortfolio(
			portfolioPositions,
			snapshot,
			candidateValue,
			currentPosition
		);
		const projectedAnalysis = this.portfolioIntelligenceService.analyzePositions(
			projectedPortfolio
		);
		const assetPercentageBefore = this.findPercentageByKey(
			portfolioAnalysis.facts.concentrationByAsset,
			snapshot.symbol
		);
		const assetPercentageAfter = this.findPercentageByKey(
			projectedAnalysis.facts.concentrationByAsset,
			snapshot.symbol
		);
		const topAssetPercentageBefore =
			portfolioAnalysis.facts.concentrationByAsset[0]?.percentage || 0;
		const topAssetPercentageAfter =
			projectedAnalysis.facts.concentrationByAsset[0]?.percentage || 0;

		const scoreFromClassification =
			portfolioFit.classification === 'bom'
				? 80
				: portfolioFit.classification === 'ruim'
					? 30
					: 55;
		let score = scoreFromClassification;
		const reasons = [...portfolioFit.signals];

		if ((snapshot.dividendYield || 0) >= 0.06) {
			score += 5;
			reasons.push('dividend_yield_attractive');
		}
		if ((snapshot.performance.changePercent || 0) > 0) {
			score += 3;
			reasons.push('recent_performance_positive');
		}
		if (portfolioAnalysis.estimates.diversification.score < 40 && !alreadyOwned) {
			score += 4;
			reasons.push('portfolio_diversification_baseline_low');
		}
		score = Math.max(0, Math.min(100, Number(score.toFixed(2))));

		return {
			score,
			status: score < 40 ? 'weak' : score < 70 ? 'neutral' : 'strong',
			reasons,
			classification: portfolioFit.classification,
			portfolioImpact: {
				alreadyInPortfolio: portfolioFit.candidate.alreadyInPortfolio,
				confidence: portfolioFit.confidence,
				diversification: portfolioFit.impact.diversification,
				concentration: {
					assetPercentageBefore: Number(assetPercentageBefore.toFixed(2)),
					assetPercentageAfter: Number(assetPercentageAfter.toFixed(2)),
					assetPercentageDelta: Number(
						(assetPercentageAfter - assetPercentageBefore).toFixed(2)
					),
					topAssetPercentageBefore: Number(topAssetPercentageBefore.toFixed(2)),
					topAssetPercentageAfter: Number(topAssetPercentageAfter.toFixed(2)),
					topAssetPercentageDelta: Number(
						(topAssetPercentageAfter - topAssetPercentageBefore).toFixed(2)
					),
				},
				sectorExposure: portfolioFit.impact.sectorConcentration,
			},
		};
	}

	private buildByDimension(
		results: AssetComparisonResult[]
	): Record<ComparisonDimension, ComparisonMetricDimensionRow[]> {
		return {
			quote: [this.buildMetricRow(results, 'price', 'higher')],
			fundamentals: [
				this.buildMetricRow(results, 'priceToEarnings', 'lower'),
				this.buildMetricRow(results, 'priceToBook', 'lower'),
				this.buildMetricRow(results, 'returnOnEquity', 'higher'),
				this.buildMetricRow(results, 'netMargin', 'higher'),
				this.buildMetricRow(results, 'evEbitda', 'lower'),
				this.buildMetricRow(results, 'marketCap', 'higher'),
			],
			dividends: [this.buildMetricRow(results, 'dividendYield', 'higher')],
			performance: [this.buildMetricRow(results, 'changePercent', 'higher')],
		};
	}

	private buildMetricRow(
		results: AssetComparisonResult[],
		metric: ComparisonMetricKey,
		preferredDirection: 'higher' | 'lower'
	): ComparisonMetricDimensionRow {
		let winnerSymbol: string | null = null;
		let winnerValue: number | null = null;
		for (const result of results) {
			const value = result.metrics[metric];
			if (typeof value !== 'number') continue;
			if (winnerValue === null) {
				winnerValue = value;
				winnerSymbol = result.symbol;
				continue;
			}
			const better =
				preferredDirection === 'higher' ? value > winnerValue : value < winnerValue;
			if (better) {
				winnerValue = value;
				winnerSymbol = result.symbol;
			}
		}

		return {
			metric,
			preferredDirection,
			winnerSymbol,
			values: results.map((result) => {
				const value = result.metrics[metric];
				return {
					symbol: result.symbol,
					value,
					available: typeof value === 'number',
					inPortfolio: result.inPortfolio,
				};
			}),
		};
	}

	private resolveCandidateValue(
		snapshot: MarketAssetSnapshot,
		currentPosition?: PortfolioIntelligencePosition
	): number {
		if (currentPosition) {
			const totalValue =
				typeof currentPosition.totalValue === 'number'
					? currentPosition.totalValue
					: Number(currentPosition.price || 0) * Number(currentPosition.quantity || 0);
			if (totalValue > 0) return totalValue;
		}
		const price = Number(snapshot.price || 0);
		return price > 0 ? price : 0;
	}

	private mergeCandidateIntoPortfolio(
		positions: PortfolioIntelligencePosition[],
		snapshot: MarketAssetSnapshot,
		candidateValue: number,
		currentPosition?: PortfolioIntelligencePosition
	): PortfolioIntelligencePosition[] {
		if (candidateValue <= 0) {
			return [...positions];
		}
		const symbol = snapshot.symbol;
		const merged = positions.map((position) => ({ ...position }));
		const index = merged.findIndex(
			(position) =>
				position.symbol.toUpperCase() === symbol && position.assetType === snapshot.assetType
		);
		if (index >= 0) {
			const current = merged[index];
			const currentValue =
				typeof current.totalValue === 'number'
					? current.totalValue
					: Number(current.price || 0) * Number(current.quantity || 0);
			merged[index] = {
				...current,
				quantity: Number(current.quantity || 0) + Number(currentPosition?.quantity || 1),
				totalValue: Number((currentValue + candidateValue).toFixed(2)),
				sector: snapshot.sector || current.sector || null,
			};
			return merged;
		}

		merged.push({
			symbol,
			assetType: snapshot.assetType,
			quantity: 1,
			totalValue: candidateValue,
			currentPrice: snapshot.price || undefined,
			sector: snapshot.sector || null,
		});
		return merged;
	}

	private findPercentageByKey(
		entries: Array<{ key: string; percentage: number }>,
		key: string
	): number {
		const found = entries.find((entry) => entry.key === key);
		return found?.percentage || 0;
	}

	private maxBy(
		items: AssetComparisonResult[],
		resolver: (item: AssetComparisonResult) => number | null
	): string | null {
		let best: { symbol: string; value: number } | null = null;
		for (const item of items) {
			const value = resolver(item);
			if (typeof value !== 'number') continue;
			if (!best || value > best.value) {
				best = { symbol: item.symbol, value };
			}
		}
		return best?.symbol || null;
	}

	private minBy(
		items: AssetComparisonResult[],
		resolver: (item: AssetComparisonResult) => number | null
	): string | null {
		let best: { symbol: string; value: number } | null = null;
		for (const item of items) {
			const value = resolver(item);
			if (typeof value !== 'number' || value <= 0) continue;
			if (!best || value < best.value) {
				best = { symbol: item.symbol, value };
			}
		}
		return best?.symbol || null;
	}
}
