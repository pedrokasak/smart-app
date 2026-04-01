import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	MarketAssetSnapshot,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import {
	OpportunityRadarInput,
	OpportunityRadarKind,
	OpportunityRadarOpportunity,
	OpportunityRadarOutput,
	OpportunityRadarSignal,
	OpportunityRadarRuleConfig,
} from 'src/intelligence/application/unified-intelligence.types';

const DEFAULT_RULES: OpportunityRadarRuleConfig = {
	maxPriceToEarnings: 10,
	minDividendYield: 0.06,
	maxDipChangePercent: -2,
	underallocationTolerancePct: 1,
	maxSignalsTotal: 8,
	maxSignalsPerKind: {
		risk: 2,
		opportunity: 3,
		fiscal: 1,
		rebalance: 2,
	},
};

@Injectable()
export class OpportunityRadarService {
	constructor(
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketDataProvider: MarketDataProviderPort,
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService
	) {}

	async detect(input: OpportunityRadarInput): Promise<OpportunityRadarOutput> {
		const portfolioPositions = input.portfolioPositions || [];
		const rules = {
			...DEFAULT_RULES,
			...(input.rules || {}),
		};
		const watchlist = Array.from(
			new Set(
				(input.watchlistSymbols || [])
					.map((item) =>
						String(item || '')
							.trim()
							.toUpperCase()
					)
					.filter(Boolean)
			)
		);
		const candidateSymbols = Array.from(
			new Set(
				[...(input.candidateSymbols || []), ...watchlist]
					.map((item) =>
						String(item || '')
							.trim()
							.toUpperCase()
					)
					.filter(Boolean)
			)
		);
		if (!candidateSymbols.length) {
			return {
				modelVersion: 'opportunity_radar_v1',
				opportunities: [],
				underallocatedSectors: this.resolveUnderallocatedSectors(
					portfolioPositions,
					input.sectorTargetAllocation,
					rules.underallocationTolerancePct
				),
				signals: [],
				unavailableSymbols: [],
				warnings: ['opportunity_radar_no_candidate_symbols'],
			};
		}

		const snapshots =
			await this.marketDataProvider.getManyAssetSnapshots(candidateSymbols);
		const snapshotBySymbol = new Map(
			snapshots.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot])
		);
		const unavailableSymbols = candidateSymbols.filter(
			(symbol) => !snapshotBySymbol.has(symbol)
		);
		const portfolioBySymbol = new Map(
			portfolioPositions.map((position) => [
				position.symbol.toUpperCase(),
				position,
			])
		);
		const underallocatedSectors = this.resolveUnderallocatedSectors(
			portfolioPositions,
			input.sectorTargetAllocation,
			rules.underallocationTolerancePct
		);
		const underallocatedSet = new Set(
			underallocatedSectors.map((item) => item.sector.toUpperCase())
		);

		const opportunities: OpportunityRadarOpportunity[] = [];
		const warnings: string[] = [];
		const rawSignals: OpportunityRadarSignal[] = [];

		for (const symbol of candidateSymbols) {
			const snapshot = snapshotBySymbol.get(symbol);
			if (!snapshot) continue;

			const inWatchlist = watchlist.includes(symbol);
			const currentPosition = portfolioBySymbol.get(symbol);
			const candidateValue = this.resolveCandidateValue(
				snapshot,
				currentPosition
			);
			const fit = this.portfolioIntelligenceService.analyzePortfolioFit(
				portfolioPositions,
				{
					symbol: snapshot.symbol,
					assetType: snapshot.assetType,
					quantity: currentPosition?.quantity || 1,
					totalValue: candidateValue,
					currentPrice: snapshot.price || undefined,
					sector: snapshot.sector,
				}
			);
			const sectorKey = String(snapshot.sector || 'UNKNOWN').toUpperCase();
			const isSectorUnderallocated = underallocatedSet.has(sectorKey);
			const attractiveSignals = this.resolveAttractiveSignals(snapshot, rules);
			const hasAttractiveSignal = attractiveSignals.length > 0;
			const hasFitSignal = fit.classification === 'bom';
			const hasRiskSignal = fit.classification === 'ruim';

			if (snapshot.metadata.partial) {
				warnings.push(`partial_data:${symbol}`);
			}
			if (snapshot.metadata.fallbackUsed) {
				warnings.push(`fallback_data:${symbol}`);
			}

			if (
				!hasAttractiveSignal &&
				!hasFitSignal &&
				!isSectorUnderallocated &&
				!inWatchlist
			) {
				if (hasRiskSignal) {
					rawSignals.push({
						id: `risk:${symbol}:fit`,
						symbol,
						kind: 'risk',
						priority: 'high',
						score: 84,
						title: `${symbol} pode piorar concentração`,
						details: fit.signals.slice(0, 3),
					});
				}
				continue;
			}

			const opportunityType = this.resolveOpportunityType({
				inWatchlist,
				hasAttractiveSignal,
				hasFitSignal,
				isSectorUnderallocated,
			});
			opportunities.push(
				this.buildOpportunity({
					snapshot,
					opportunityType,
					inWatchlist,
					attractiveSignals,
					fit,
					isSectorUnderallocated,
					underallocatedSectors,
				})
			);

			rawSignals.push(
				this.buildOpportunitySignal({
					symbol,
					type: opportunityType,
					fitClassification: fit.classification,
					sectorUnderallocated: isSectorUnderallocated,
					inWatchlist,
				})
			);
		}

		for (const sector of underallocatedSectors) {
			rawSignals.push({
				id: `rebalance:sector:${sector.sector}`,
				symbol: null,
				kind: 'rebalance',
				priority: sector.deltaPercentage >= 10 ? 'high' : 'medium',
				score: sector.deltaPercentage >= 10 ? 78 : 63,
				title: `Setor ${sector.sector} subalocado`,
				details: [
					`Atual: ${sector.currentPercentage}%`,
					`Alvo: ${sector.targetPercentage}%`,
					`Gap: ${sector.deltaPercentage}%`,
				],
			});
		}
		if (input.fiscalContext?.hasCompensableLoss) {
			rawSignals.push({
				id: 'fiscal:compensable_loss',
				symbol: null,
				kind: 'fiscal',
				priority: 'medium',
				score: 58,
				title: 'Prejuízo compensável disponível',
				details: ['Há base fiscal para potencial compensação futura.'],
			});
		}
		const signals = this.prioritizeSignals(rawSignals, rules);
		if (!signals.length) {
			warnings.push('opportunity_radar_no_relevant_signals');
		}

		return {
			modelVersion: 'opportunity_radar_v1',
			opportunities,
			underallocatedSectors,
			signals,
			unavailableSymbols,
			warnings: Array.from(new Set(warnings)),
		};
	}

	private buildOpportunitySignal(input: {
		symbol: string;
		type: OpportunityRadarOpportunity['type'];
		fitClassification: 'bom' | 'neutro' | 'ruim';
		sectorUnderallocated: boolean;
		inWatchlist: boolean;
	}): OpportunityRadarSignal {
		if (input.type === 'watchlist_trigger') {
			return {
				id: `opportunity:${input.symbol}:watchlist`,
				symbol: input.symbol,
				kind: 'opportunity',
				priority: 'high',
				score: 81,
				title: `${input.symbol} em condição interessante na watchlist`,
				details: ['Ativo monitorado com gatilho ativo no radar.'],
			};
		}
		if (input.type === 'attractive_range' || input.type === 'portfolio_fit') {
			return {
				id: `opportunity:${input.symbol}:${input.type}`,
				symbol: input.symbol,
				kind: 'opportunity',
				priority: input.inWatchlist ? 'high' : 'medium',
				score: input.inWatchlist ? 79 : 62,
				title: `${input.symbol} com sinal de oportunidade`,
				details: ['Sinais de valuation/dividendos/fit detectados.'],
			};
		}
		if (input.fitClassification === 'ruim') {
			return {
				id: `risk:${input.symbol}:fit`,
				symbol: input.symbol,
				kind: 'risk',
				priority: 'high',
				score: 83,
				title: `${input.symbol} com encaixe fraco na carteira`,
				details: ['Impacto potencial negativo em concentração/diversificação.'],
			};
		}
		if (input.sectorUnderallocated || input.type === 'sector_underallocated') {
			return {
				id: `rebalance:${input.symbol}:sector`,
				symbol: input.symbol,
				kind: 'rebalance',
				priority: 'medium',
				score: 64,
				title: `${input.symbol} pode ajudar no rebalanceamento setorial`,
				details: ['Ativo alinhado a setor abaixo da alocação alvo.'],
			};
		}
		return {
			id: `rebalance:${input.symbol}:sector`,
			symbol: input.symbol,
			kind: 'rebalance',
			priority: 'medium',
			score: 61,
			title: `${input.symbol} pode ajudar no rebalanceamento setorial`,
			details: ['Ativo alinhado a setor abaixo da alocação alvo.'],
		};
	}

	private prioritizeSignals(
		rawSignals: OpportunityRadarSignal[],
		rules: OpportunityRadarRuleConfig
	): OpportunityRadarSignal[] {
		const ranked = [...rawSignals].sort((a, b) => b.score - a.score);
		const maxTotal = Number(
			rules.maxSignalsTotal || DEFAULT_RULES.maxSignalsTotal || 8
		);
		const limitsByKind = {
			...DEFAULT_RULES.maxSignalsPerKind,
			...(rules.maxSignalsPerKind || {}),
		} as Record<OpportunityRadarKind, number>;
		const counts: Record<OpportunityRadarKind, number> = {
			risk: 0,
			opportunity: 0,
			fiscal: 0,
			rebalance: 0,
		};

		const selected: OpportunityRadarSignal[] = [];
		for (const signal of ranked) {
			if (selected.length >= maxTotal) break;
			const kindLimit = Number(limitsByKind[signal.kind] || 0);
			if (kindLimit > 0 && counts[signal.kind] >= kindLimit) {
				continue;
			}
			selected.push(signal);
			counts[signal.kind] += 1;
		}
		return selected;
	}

	private resolveUnderallocatedSectors(
		positions: PortfolioIntelligencePosition[],
		targets: Record<string, number> | undefined,
		tolerancePct: number
	): OpportunityRadarOutput['underallocatedSectors'] {
		if (!targets || !Object.keys(targets).length) return [];
		const analysis =
			this.portfolioIntelligenceService.analyzePositions(positions);
		const sectorByKey = new Map(
			analysis.facts.concentrationBySector.map((entry) => [
				String(entry.key || '').toUpperCase(),
				entry.percentage,
			])
		);

		return Object.entries(targets)
			.map(([sector, targetPercentage]) => {
				const key = String(sector || '')
					.trim()
					.toUpperCase();
				const target = Number(targetPercentage || 0);
				if (!key || !Number.isFinite(target) || target <= 0) return null;
				const current = Number(sectorByKey.get(key) || 0);
				const delta = Number((target - current).toFixed(2));
				if (delta <= tolerancePct) return null;
				return {
					sector: key,
					currentPercentage: Number(current.toFixed(2)),
					targetPercentage: Number(target.toFixed(2)),
					deltaPercentage: delta,
				};
			})
			.filter((entry): entry is NonNullable<typeof entry> => !!entry)
			.sort((a, b) => b.deltaPercentage - a.deltaPercentage);
	}

	private resolveAttractiveSignals(
		snapshot: MarketAssetSnapshot,
		rules: OpportunityRadarRuleConfig
	): string[] {
		const signals: string[] = [];
		const pe = snapshot.fundamentals.priceToEarnings;
		if (typeof pe === 'number' && pe > 0 && pe <= rules.maxPriceToEarnings) {
			signals.push('valuation_price_to_earnings_attractive');
		}
		const dy = snapshot.dividendYield;
		if (typeof dy === 'number' && dy >= rules.minDividendYield) {
			signals.push('dividend_yield_attractive');
		}
		const changePercent = snapshot.performance.changePercent;
		if (
			typeof changePercent === 'number' &&
			changePercent <= rules.maxDipChangePercent
		) {
			signals.push('price_dip_signal');
		}
		return signals;
	}

	private resolveOpportunityType(input: {
		inWatchlist: boolean;
		hasAttractiveSignal: boolean;
		hasFitSignal: boolean;
		isSectorUnderallocated: boolean;
	}): OpportunityRadarOpportunity['type'] {
		if (input.inWatchlist) return 'watchlist_trigger';
		if (input.hasFitSignal) return 'portfolio_fit';
		if (input.isSectorUnderallocated) return 'sector_underallocated';
		return 'attractive_range';
	}

	private buildOpportunity(input: {
		snapshot: MarketAssetSnapshot;
		opportunityType: OpportunityRadarOpportunity['type'];
		inWatchlist: boolean;
		attractiveSignals: string[];
		fit: ReturnType<PortfolioIntelligenceService['analyzePortfolioFit']>;
		isSectorUnderallocated: boolean;
		underallocatedSectors: OpportunityRadarOutput['underallocatedSectors'];
	}): OpportunityRadarOpportunity {
		const sector = String(input.snapshot.sector || 'UNKNOWN').toUpperCase();
		const sectorGap =
			input.underallocatedSectors.find((item) => item.sector === sector) ||
			null;
		return {
			symbol: input.snapshot.symbol,
			type: input.opportunityType,
			rationale: {
				signals: Array.from(
					new Set([
						...input.attractiveSignals,
						...(input.fit.classification === 'bom'
							? ['portfolio_fit_positive']
							: []),
						...(input.isSectorUnderallocated
							? ['sector_underallocated_opportunity']
							: []),
						...(input.inWatchlist ? ['watchlist_monitored_asset'] : []),
						...(input.snapshot.metadata.partial ? ['partial_market_data'] : []),
						...(input.snapshot.metadata.fallbackUsed
							? ['provider_fallback_used']
							: []),
					])
				),
				metrics: {
					price: input.snapshot.price,
					priceToEarnings: input.snapshot.fundamentals.priceToEarnings,
					dividendYield: input.snapshot.dividendYield,
					changePercent: input.snapshot.performance.changePercent,
					sector,
				},
			},
			expectedPortfolioImpact: {
				fitClassification: input.fit.classification,
				diversificationDeltaScore: input.fit.impact.diversification.deltaScore,
				sectorDeltaPercentage:
					input.fit.impact.sectorConcentration.deltaPercentage,
				underallocatedSectorGap: sectorGap?.deltaPercentage || null,
			},
			dataQuality: {
				partial: input.snapshot.metadata.partial,
				fallbackUsed: input.snapshot.metadata.fallbackUsed,
				fallbackSources: input.snapshot.metadata.fallbackSources,
			},
		};
	}

	private resolveCandidateValue(
		snapshot: MarketAssetSnapshot,
		currentPosition?: PortfolioIntelligencePosition
	): number | undefined {
		if (currentPosition && typeof currentPosition.totalValue === 'number') {
			if (currentPosition.totalValue > 0) return currentPosition.totalValue;
		}
		if (typeof snapshot.price === 'number' && snapshot.price > 0) {
			return snapshot.price;
		}
		return undefined;
	}
}
