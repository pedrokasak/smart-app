import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	type MarketAssetType,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	computeRiskContribution,
	type RiskContributionResult,
} from 'src/portfolio/history/risk-contribution';
import { PortfolioService } from 'src/portfolio/portfolio.service';

/**
 * Contribuição de risco por ativo da carteira do usuário (TRA-141), para o
 * card da tela Portfólio do handoff.
 *
 * Entram ação, FII, ETF e cripto — esta última desde que `getDailyCloses`
 * passou a receber o tipo e normalizar o par em reais (BTC-BRL). O que fica de
 * fora é devolvido em `missingSymbols` e `excludedValuePct`, para a tela dizer.
 */

/** A fonte é rate-limited; acima disso a lista também deixa de ser legível. */
const MAX_SYMBOLS = 15;
/** Tipos com fechamento diário disponível. Renda fixa e fundo não têm. */
const PRICED_TYPES = new Set(['stock', 'fii', 'etf', 'crypto']);

export interface PortfolioRiskContributionOutput extends RiskContributionResult {
	/** Posições acima do teto, somadas em "Demais". */
	truncated: boolean;
}

@Injectable()
export class PortfolioRiskContributionService {
	constructor(
		private readonly portfolioService: PortfolioService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	async getRiskContribution(
		userId: string
	): Promise<PortfolioRiskContributionOutput> {
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = (portfolios || []).flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		// Valor a MERCADO; `total` é custo de aquisição.
		const bySymbol = new Map<string, { type: string; marketValue: number }>();
		for (const asset of assets) {
			const symbol = String(asset?.symbol || '').toUpperCase();
			const quantity = Number(asset?.quantity) || 0;
			const price = Number(asset?.currentPrice) || Number(asset?.price) || 0;
			if (!symbol || quantity <= 0 || price <= 0) continue;
			const existing = bySymbol.get(symbol);
			bySymbol.set(symbol, {
				type: String(asset?.type || 'other'),
				marketValue: (existing?.marketValue || 0) + quantity * price,
			});
		}

		const ranked = [...bySymbol.entries()]
			.map(([symbol, entry]) => ({ symbol, ...entry }))
			.sort((a, b) => b.marketValue - a.marketValue);
		const listed = ranked.filter((entry) => PRICED_TYPES.has(entry.type));
		const selected = listed.slice(0, MAX_SYMBOLS);

		const closesEntries = await Promise.all(
			selected.map(
				async (entry) =>
					[
						entry.symbol,
						await this.marketData.getDailyCloses(
							entry.symbol,
							'1y',
							entry.type as MarketAssetType
						),
					] as const
			)
		);

		const result = computeRiskContribution({
			// Não listados e excedentes entram só no valor total, para
			// `excludedValuePct` refletir tudo o que não foi medido.
			positions: ranked.map((entry) => ({
				symbol: entry.symbol,
				marketValue: entry.marketValue,
			})),
			closesBySymbol: Object.fromEntries(closesEntries),
		});

		return { ...result, truncated: listed.length > MAX_SYMBOLS };
	}
}
