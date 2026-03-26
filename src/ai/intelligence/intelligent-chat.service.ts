import { Inject, Injectable } from '@nestjs/common';
import { ComparisonEngineService } from 'src/comparison/application/comparison-engine.service';
import {
	MARKET_DATA_PROVIDER,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

type ChatIntent =
	| 'portfolio_summary'
	| 'portfolio_risk'
	| 'asset_comparison'
	| 'asset_analysis'
	| 'external_asset_question'
	| 'unknown';

export interface IntelligentChatResponse {
	intent: ChatIntent;
	deterministic: true;
	portfolioFacts: Record<string, unknown> | null;
	externalData: Record<string, unknown> | null;
	estimates: Record<string, unknown> | null;
	unavailable: string[];
	message: string;
}

@Injectable()
export class IntelligentChatService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService,
		private readonly comparisonEngineService: ComparisonEngineService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketDataProvider: MarketDataProviderPort
	) {}

	async respond(
		userId: string,
		question: string
	): Promise<IntelligentChatResponse> {
		const normalizedQuestion = String(question || '').trim();
		const symbols = this.extractSymbols(normalizedQuestion);

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const positions = this.toPositions(assets);
		const portfolioBySymbol = new Map(
			positions.map((position) => [position.symbol.toUpperCase(), position])
		);

		const baseIntent = this.classifyIntent(normalizedQuestion, symbols);

		if (baseIntent === 'asset_comparison' && symbols.length >= 2) {
			const comparison = await this.comparisonEngineService.compareAssets({
				symbols,
				portfolioPositions: positions,
			});
			return {
				intent: 'asset_comparison',
				deterministic: true,
				portfolioFacts: {
					portfolioAssetsCount: positions.length,
					portfolioSymbolsCompared: comparison.results
						.filter((item) => item.inPortfolio)
						.map((item) => item.symbol),
				},
				externalData: {
					comparison,
				},
				estimates: {
					bestFitSymbol: comparison.executiveSummary.bestFitSymbol,
				},
				unavailable: comparison.unavailableSymbols,
				message:
					'Comparação determinística concluída com dados de mercado disponíveis.',
			};
		}

		if (symbols.length >= 1) {
			const targetSymbol = symbols[0];
			const owned = portfolioBySymbol.get(targetSymbol);

			if (owned) {
				const intelligence =
					this.portfolioIntelligenceService.analyzePositions(positions);
				const externalSnapshot =
					await this.marketDataProvider.getAssetSnapshot(targetSymbol);
				return {
					intent: 'asset_analysis',
					deterministic: true,
					portfolioFacts: {
						symbol: targetSymbol,
						positionValue: owned.totalValue || owned.price * owned.quantity,
						quantity: owned.quantity,
						assetType: owned.assetType,
						sector: owned.sector || null,
						totalPositions: intelligence.facts.positionsCount,
					},
					externalData: externalSnapshot
						? {
								snapshot: externalSnapshot,
							}
						: null,
					estimates: {
						portfolioRisk: intelligence.estimates.risk,
						diversification: intelligence.estimates.diversification,
					},
					unavailable: externalSnapshot ? [] : [targetSymbol],
					message:
						'Ativo encontrado na carteira. Resposta combina fatos da carteira com dados externos e estimativas de risco.',
				};
			}

			const externalSnapshot =
				await this.marketDataProvider.getAssetSnapshot(targetSymbol);
			if (!externalSnapshot) {
				return {
					intent: 'external_asset_question',
					deterministic: true,
					portfolioFacts: {
						owned: false,
						symbol: targetSymbol,
					},
					externalData: null,
					estimates: null,
					unavailable: [targetSymbol],
					message: 'Sem dados disponíveis para o ativo solicitado no momento.',
				};
			}

			const comparison = await this.comparisonEngineService.compareAssets({
				symbols: [targetSymbol],
				portfolioPositions: positions,
			});
			const fit = comparison.results[0]?.fit || null;

			return {
				intent: 'external_asset_question',
				deterministic: true,
				portfolioFacts: {
					owned: false,
					symbol: targetSymbol,
					portfolioAssetsCount: positions.length,
				},
				externalData: {
					snapshot: externalSnapshot,
				},
				estimates: fit
					? {
							fit,
						}
					: null,
				unavailable: [],
				message:
					'Ativo fora da carteira analisado com dados externos e estimativa de encaixe no portfólio.',
			};
		}

		if (baseIntent === 'portfolio_summary' || baseIntent === 'portfolio_risk') {
			const intelligence =
				this.portfolioIntelligenceService.analyzePositions(positions);
			return {
				intent: baseIntent,
				deterministic: true,
				portfolioFacts: {
					totalValue: intelligence.facts.totalValue,
					positionsCount: intelligence.facts.positionsCount,
					allocationByClass: intelligence.facts.allocationByClass,
					concentrationByAsset: intelligence.facts.concentrationByAsset,
					concentrationBySector: intelligence.facts.concentrationBySector,
				},
				externalData: null,
				estimates: {
					diversification: intelligence.estimates.diversification,
					risk: intelligence.estimates.risk,
				},
				unavailable: [],
				message:
					baseIntent === 'portfolio_risk'
						? 'Análise inicial de risco da carteira concluída.'
						: 'Resumo determinístico da carteira concluído.',
			};
		}

		return {
			intent: 'unknown',
			deterministic: true,
			portfolioFacts: null,
			externalData: null,
			estimates: null,
			unavailable: [],
			message: 'Não foi possível classificar a intenção com segurança.',
		};
	}

	private classifyIntent(question: string, symbols: string[]): ChatIntent {
		const text = question.toLowerCase();
		if (
			symbols.length >= 2 ||
			/\b(vs|versus|comparar|compare|comparacao|comparação)\b/.test(text)
		) {
			return 'asset_comparison';
		}
		if (/\b(risco|risk|volatilidade|concentrad)\b/.test(text)) {
			return 'portfolio_risk';
		}
		if (
			/\b(carteira|portfolio|alocacao|alocação|diversifica|resumo)\b/.test(text)
		) {
			return 'portfolio_summary';
		}
		if (symbols.length >= 1) {
			return 'asset_analysis';
		}
		return 'unknown';
	}

	private extractSymbols(question: string): string[] {
		const normalized = question.toUpperCase();
		const brSymbols = normalized.match(/\b[A-Z]{4}\d{1,2}\b/g) || [];
		const cryptoSymbols = normalized.match(/\b(BTC|ETH|SOL|ADA|XRP)\b/g) || [];
		const usSymbols = normalized.match(/\b[A-Z]{1,5}\.[A-Z]{1,3}\b/g) || [];

		const candidateSymbols = [
			...brSymbols,
			...cryptoSymbols,
			...usSymbols,
		].filter((symbol) => symbol.length >= 3 && !this.stopWords.has(symbol));
		return Array.from(new Set(candidateSymbols)).slice(0, 6);
	}

	private toPositions(assets: any[]): PortfolioIntelligencePosition[] {
		return assets
			.map((asset: any) => ({
				symbol: String(asset?.symbol || '')
					.trim()
					.toUpperCase(),
				assetType: (asset?.type || 'other') as
					| 'stock'
					| 'fii'
					| 'crypto'
					| 'etf'
					| 'fund'
					| 'other',
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
				volatility:
					typeof asset?.volatility === 'number' ? asset.volatility : undefined,
				beta: typeof asset?.beta === 'number' ? asset.beta : undefined,
			}))
			.filter((position) => !!position.symbol);
	}

	private readonly stopWords = new Set([
		'QUAL',
		'COMO',
		'PARA',
		'SOBRE',
		'ATIVO',
		'ATIVOS',
		'CARTEIRA',
		'COMPARE',
		'COMPARAR',
		'RISCO',
		'MINHA',
		'MEU',
		'ESTA',
		'ESTÁ',
	]);
}
