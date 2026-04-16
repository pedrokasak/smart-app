import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { TradeDecisionService } from 'src/intelligence/application/trade-decision.service';
import {
	TrackerrScoreInput,
	TrackerrScoreOutput,
	TrackerrScorePillar,
	TrackerrScoreReasonCode,
} from 'src/intelligence/application/trackerr-score.types';

const PILLAR_WEIGHTS: Record<TrackerrScorePillar, number> = {
	qualidade: 0.25,
	risco: 0.2,
	valuation: 0.2,
	fiscal: 0.15,
	portfolio_fit: 0.2,
};

@Injectable()
export class TrackerrScoreService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService,
		private readonly tradeDecisionService: TradeDecisionService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketDataProvider: MarketDataProviderPort
	) {}

	async getScoreForUser(
		userId: string,
		symbol: string,
		input?: {
			previousPillarScores?: Partial<Record<TrackerrScorePillar, number>>;
		}
	): Promise<TrackerrScoreOutput> {
		const normalizedSymbol = String(symbol || '').trim().toUpperCase();
		const warnings: string[] = [];
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const positions = assets
			.map((asset: any) => ({
				symbol: String(asset?.symbol || '').toUpperCase(),
				assetType: asset?.type || 'other',
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number'
						? Number(asset.total)
						: Number(asset?.price || 0) * Number(asset?.quantity || 0),
				price: Number(asset?.price || 0),
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
			}))
			.filter((position) => !!position.symbol);
		const ownedPosition = positions.find(
			(position) => position.symbol === normalizedSymbol
		);

		const snapshot = await this.marketDataProvider.getAssetSnapshot(normalizedSymbol);
		if (!snapshot) {
			warnings.push('trackerr_score_market_data_unavailable');
		}

		const totalValue = positions.reduce(
			(sum, position) => sum + Number(position.totalValue || 0),
			0
		);
		const concentrationPct =
			totalValue > 0 && ownedPosition
				? Number((((ownedPosition.totalValue || 0) / totalValue) * 100).toFixed(2))
				: null;

		let fiscalEstimatedTax = 0;
		let fiscalTaxRate = 0;
		let fiscalMonthlyExemptionApplied = false;
		if (ownedPosition && snapshot?.price) {
			const decision = this.tradeDecisionService.buildPreAndPostTrade({
				symbol: normalizedSymbol,
				assetType: (ownedPosition.assetType as any) || 'other',
				quantityToSell: Number(ownedPosition.quantity || 0),
				sellPrice: Number(snapshot.price || 0),
				simulatedSellDate: new Date().toISOString(),
				currentPosition: {
					quantity: Number(ownedPosition.quantity || 0),
					totalCost: Number(ownedPosition.totalValue || 0),
				},
				totalPortfolioValue: totalValue,
			});
			fiscalEstimatedTax = decision.preTrade.estimatedTax;
			fiscalTaxRate = decision.preTrade.taxRateApplied;
			fiscalMonthlyExemptionApplied =
				decision.preTrade.explanation.includes('isenção');
		}

		let fitClassification: 'bom' | 'neutro' | 'ruim' | 'unknown' = 'unknown';
		let diversificationDeltaScore: number | null = null;
		if (snapshot?.price && positions.length > 0) {
			const fit = this.portfolioIntelligenceService.analyzePortfolioFit(
				positions as any,
				{
					symbol: normalizedSymbol,
					assetType: snapshot.assetType,
					quantity: ownedPosition?.quantity || 1,
					totalValue:
						ownedPosition?.totalValue || Number(snapshot.price || 0),
					currentPrice: Number(snapshot.price || 0),
					sector: snapshot.sector,
				}
			);
			fitClassification = fit.classification;
			diversificationDeltaScore = Number(
				fit.impact?.diversification?.deltaScore || 0
			);
		} else {
			warnings.push('trackerr_score_portfolio_fit_partial');
		}

		const score = this.computeScore({
			symbol: normalizedSymbol,
			assetType: (snapshot?.assetType as any) || (ownedPosition?.assetType as any) || 'other',
			qualityMetrics: {
				roe: snapshot?.fundamentals?.returnOnEquity ?? null,
				netMargin: snapshot?.fundamentals?.netMargin ?? null,
				dividendYield: snapshot?.dividendYield ?? null,
			},
			riskMetrics: {
				changePercent24h: snapshot?.performance?.changePercent ?? null,
				concentrationPct,
			},
			valuationMetrics: {
				priceToEarnings: snapshot?.fundamentals?.priceToEarnings ?? null,
				priceToBook: snapshot?.fundamentals?.priceToBook ?? null,
			},
			fiscalMetrics: {
				estimatedTaxRateOnPnl: fiscalTaxRate || null,
				estimatedTaxAbsolute: fiscalEstimatedTax || null,
				monthlyExemptionApplied: fiscalMonthlyExemptionApplied,
				hasOwnedPosition: Boolean(ownedPosition),
			},
			portfolioFitMetrics: {
				fitClassification,
				diversificationDeltaScore,
			},
			previousPillarScores: input?.previousPillarScores,
		});

		if (snapshot?.metadata?.partial) warnings.push('trackerr_score_partial_market_data');
		if (snapshot?.metadata?.fallbackUsed) warnings.push('trackerr_score_fallback_market_data');

		return {
			...score,
			status: warnings.length > 0 ? 'degraded' : 'ok',
			warnings: Array.from(new Set([...score.warnings, ...warnings])),
		};
	}

	computeScore(input: TrackerrScoreInput): TrackerrScoreOutput {
		const quality = this.computeQualityScore(input);
		const risk = this.computeRiskScore(input);
		const valuation = this.computeValuationScore(input);
		const fiscal = this.computeFiscalScore(input);
		const fit = this.computePortfolioFitScore(input);

		const pillars = [quality, risk, valuation, fiscal, fit].map((pillar) => ({
			...pillar,
			weightedScore: Number((pillar.score * PILLAR_WEIGHTS[pillar.pillar]).toFixed(2)),
		}));

		const overallScore = Number(
			pillars
				.reduce((sum, pillar) => sum + pillar.weightedScore, 0)
				.toFixed(2)
		);

		const scoreDirectionReasons = this.buildScoreDirectionReasons(input, pillars);

		return {
			symbol: input.symbol,
			assetType: input.assetType,
			status: 'ok',
			overall: overallScore,
			overallScore,
			weights: PILLAR_WEIGHTS,
			pillars,
			reasonCodes: scoreDirectionReasons,
			warnings: [],
			explanation: {
				summary: `Trackerr Score calculado com pilares fixos e pesos visíveis. Resultado atual: ${overallScore}/100.`,
				topPositiveDrivers: pillars
					.flatMap((pillar) => pillar.reasonCodes)
					.filter((reason) => reason.direction === 'up')
					.map((reason) => reason.description)
					.slice(0, 3),
				topNegativeDrivers: pillars
					.flatMap((pillar) => pillar.reasonCodes)
					.filter((reason) => reason.direction === 'down')
					.map((reason) => reason.description)
					.slice(0, 3),
			},
		};
	}

	build(input: any): TrackerrScoreOutput {
		if (input?.qualityMetrics) {
			return this.computeScore(input as TrackerrScoreInput);
		}
		const positions = Array.isArray(input?.positions) ? input.positions : [];
		const targetSymbol =
			String(input?.targetSymbol || positions?.[0]?.symbol || 'PORTFOLIO').toUpperCase();
		const targetSnapshot = input?.targetSnapshot;
		const targetPosition =
			positions.find(
				(position: any) =>
					String(position?.symbol || '').toUpperCase() === targetSymbol
			) || null;
		const totalValue = positions.reduce(
			(sum: number, position: any) => sum + Number(position?.totalValue || 0),
			0
		);
		const concentrationPct =
			totalValue > 0 && targetPosition
				? Number(((Number(targetPosition.totalValue || 0) / totalValue) * 100).toFixed(2))
				: null;
		const sellSimulation = input?.sellSimulation;
		return this.computeScore({
			symbol: targetSymbol,
			assetType: (targetSnapshot?.assetType || targetPosition?.assetType || 'other') as any,
			qualityMetrics: {
				roe: targetSnapshot?.fundamentals?.returnOnEquity ?? null,
				netMargin: targetSnapshot?.fundamentals?.netMargin ?? null,
				dividendYield: targetSnapshot?.dividendYield ?? null,
			},
			riskMetrics: {
				changePercent24h: targetSnapshot?.performance?.changePercent ?? null,
				concentrationPct,
			},
			valuationMetrics: {
				priceToEarnings: targetSnapshot?.fundamentals?.priceToEarnings ?? null,
				priceToBook: targetSnapshot?.fundamentals?.priceToBook ?? null,
			},
			fiscalMetrics: {
				estimatedTaxRateOnPnl: sellSimulation?.taxRateApplied ?? null,
				estimatedTaxAbsolute: sellSimulation?.estimatedTax ?? null,
				monthlyExemptionApplied: Boolean(sellSimulation?.monthlyExemptionApplied),
				hasOwnedPosition: Boolean(targetPosition),
			},
			portfolioFitMetrics: {
				fitClassification: 'unknown',
				diversificationDeltaScore: null,
			},
		});
	}

	private computeQualityScore(input: TrackerrScoreInput) {
		const reasonCodes: TrackerrScoreReasonCode[] = [];
		const roe = input.qualityMetrics.roe;
		const margin = input.qualityMetrics.netMargin;
		const dy = input.qualityMetrics.dividendYield;
		let score = 50;

		if (roe !== null) {
			if (roe >= 18) {
				score += 25;
				reasonCodes.push(this.reason('score_up_quality_roe_high', 'qualidade', 'up', 'ROE robusto sustentando qualidade.', 0.25));
			} else if (roe < 8) {
				score -= 20;
				reasonCodes.push(this.reason('score_down_quality_roe_low', 'qualidade', 'down', 'ROE baixo reduz qualidade estrutural.', 0.25));
			}
		} else {
			reasonCodes.push(this.reason('score_neutral_quality_roe_missing', 'qualidade', 'neutral', 'ROE indisponível.', 0));
		}

		if (margin !== null) {
			if (margin >= 0.15) {
				score += 15;
				reasonCodes.push(this.reason('score_up_quality_margin_high', 'qualidade', 'up', 'Margem líquida saudável.', 0.15));
			} else if (margin < 0.05) {
				score -= 12;
				reasonCodes.push(this.reason('score_down_quality_margin_low', 'qualidade', 'down', 'Margem comprimida.', 0.15));
			}
		}

		if (dy !== null && dy >= 0.06) {
			score += 5;
			reasonCodes.push(this.reason('score_up_quality_dividend_support', 'qualidade', 'up', 'Dividend yield contribui para consistência.', 0.05));
		}

		return {
			pillar: 'qualidade' as const,
			weight: PILLAR_WEIGHTS.qualidade,
			score: this.clampScore(score),
			reasonCodes,
		};
	}

	private computeRiskScore(input: TrackerrScoreInput) {
		const reasonCodes: TrackerrScoreReasonCode[] = [];
		let score = 65;
		const change24h = input.riskMetrics.changePercent24h;
		const concentration = input.riskMetrics.concentrationPct;

		if (change24h !== null && Math.abs(change24h) >= 6) {
			score -= 15;
			reasonCodes.push(this.reason('score_down_risk_volatility_spike', 'risco', 'down', 'Volatilidade de curto prazo elevada.', 0.2));
		}
		if (concentration !== null) {
			if (concentration >= 20) {
				score -= 20;
				reasonCodes.push(this.reason('score_down_risk_concentration_high', 'risco', 'down', 'Concentração elevada no ativo.', 0.2));
			} else if (concentration <= 8) {
				score += 8;
				reasonCodes.push(this.reason('score_up_risk_concentration_balanced', 'risco', 'up', 'Peso equilibrado na carteira.', 0.1));
			}
		}

		return {
			pillar: 'risco' as const,
			weight: PILLAR_WEIGHTS.risco,
			score: this.clampScore(score),
			reasonCodes,
		};
	}

	private computeValuationScore(input: TrackerrScoreInput) {
		const reasonCodes: TrackerrScoreReasonCode[] = [];
		let score = 50;
		const pe = input.valuationMetrics.priceToEarnings;
		const pb = input.valuationMetrics.priceToBook;

		if (pe !== null) {
			if (pe > 22) {
				score -= 18;
				reasonCodes.push(this.reason('score_down_valuation_pe_expensive', 'valuation', 'down', 'P/L acima da faixa de conforto.', 0.2));
			} else if (pe > 0 && pe <= 12) {
				score += 18;
				reasonCodes.push(this.reason('score_up_valuation_pe_attractive', 'valuation', 'up', 'P/L atrativo frente ao lucro.', 0.2));
			}
		}
		if (pb !== null) {
			if (pb > 3) {
				score -= 10;
				reasonCodes.push(this.reason('score_down_valuation_pb_stretched', 'valuation', 'down', 'P/VP esticado.', 0.1));
			} else if (pb > 0 && pb <= 1.5) {
				score += 10;
				reasonCodes.push(this.reason('score_up_valuation_pb_reasonable', 'valuation', 'up', 'P/VP em faixa razoável.', 0.1));
			}
		}

		return {
			pillar: 'valuation' as const,
			weight: PILLAR_WEIGHTS.valuation,
			score: this.clampScore(score),
			reasonCodes,
		};
	}

	private computeFiscalScore(input: TrackerrScoreInput) {
		const reasonCodes: TrackerrScoreReasonCode[] = [];
		if (!input.fiscalMetrics.hasOwnedPosition) {
			reasonCodes.push(this.reason('score_neutral_fiscal_no_owned_position', 'fiscal', 'neutral', 'Sem posição própria para simulação fiscal.', 0));
			return {
				pillar: 'fiscal' as const,
				weight: PILLAR_WEIGHTS.fiscal,
				score: 50,
				reasonCodes,
			};
		}

		let score = 55;
		if (input.fiscalMetrics.monthlyExemptionApplied) {
			score += 25;
			reasonCodes.push(this.reason('score_up_fiscal_monthly_exemption', 'fiscal', 'up', 'Isenção mensal aplicável na simulação.', 0.15));
		}
		if ((input.fiscalMetrics.estimatedTaxAbsolute || 0) > 0) {
			score -= 18;
			reasonCodes.push(this.reason('score_down_fiscal_tax_due', 'fiscal', 'down', 'Venda gera DARF estimado positivo.', 0.15));
		}

		return {
			pillar: 'fiscal' as const,
			weight: PILLAR_WEIGHTS.fiscal,
			score: this.clampScore(score),
			reasonCodes,
		};
	}

	private computePortfolioFitScore(input: TrackerrScoreInput) {
		const reasonCodes: TrackerrScoreReasonCode[] = [];
		let score = 50;
		if (input.portfolioFitMetrics.fitClassification === 'bom') {
			score = 80;
			reasonCodes.push(this.reason('score_up_portfolio_fit_good', 'portfolio_fit', 'up', 'Ativo melhora encaixe da carteira.', 0.2));
		} else if (input.portfolioFitMetrics.fitClassification === 'ruim') {
			score = 30;
			reasonCodes.push(this.reason('score_down_portfolio_fit_poor', 'portfolio_fit', 'down', 'Ativo piora perfil de carteira.', 0.2));
		} else if (input.portfolioFitMetrics.fitClassification === 'unknown') {
			reasonCodes.push(this.reason('score_neutral_portfolio_fit_unknown', 'portfolio_fit', 'neutral', 'Fit não pôde ser validado.', 0));
		}

		const delta = input.portfolioFitMetrics.diversificationDeltaScore;
		if (typeof delta === 'number') {
			if (delta >= 3) {
				score += 8;
				reasonCodes.push(this.reason('score_up_portfolio_fit_diversification', 'portfolio_fit', 'up', 'Diversificação melhora no cenário estimado.', 0.1));
			} else if (delta <= -3) {
				score -= 8;
				reasonCodes.push(this.reason('score_down_portfolio_fit_diversification', 'portfolio_fit', 'down', 'Diversificação piora no cenário estimado.', 0.1));
			}
		}

		return {
			pillar: 'portfolio_fit' as const,
			weight: PILLAR_WEIGHTS.portfolio_fit,
			score: this.clampScore(score),
			reasonCodes,
		};
	}

	private buildScoreDirectionReasons(
		input: TrackerrScoreInput,
		pillars: Array<{ pillar: TrackerrScorePillar; score: number; reasonCodes: TrackerrScoreReasonCode[] }>
	) {
		if (input.previousPillarScores) {
			const upward = pillars
				.filter(
					(pillar) =>
						typeof input.previousPillarScores?.[pillar.pillar] === 'number' &&
						pillar.score > Number(input.previousPillarScores[pillar.pillar])
				)
				.map((pillar) => `score_up_${pillar.pillar}_vs_previous`);
			const downward = pillars
				.filter(
					(pillar) =>
						typeof input.previousPillarScores?.[pillar.pillar] === 'number' &&
						pillar.score < Number(input.previousPillarScores[pillar.pillar])
				)
				.map((pillar) => `score_down_${pillar.pillar}_vs_previous`);
			return {
				upward,
				downward,
			};
		}

		const allReasons = pillars.flatMap((pillar) => pillar.reasonCodes);
		return {
			upward: allReasons
				.filter((reason) => reason.direction === 'up')
				.map((reason) => reason.code),
			downward: allReasons
				.filter((reason) => reason.direction === 'down')
				.map((reason) => reason.code),
		};
	}

	private reason(
		code: string,
		pillar: TrackerrScorePillar,
		direction: 'up' | 'down' | 'neutral',
		description: string,
		weightImpact: number
	): TrackerrScoreReasonCode {
		return {
			code,
			pillar,
			direction,
			description,
			weightImpact,
		};
	}

	private clampScore(value: number): number {
		return Math.max(0, Math.min(100, Number(value.toFixed(2))));
	}
}
