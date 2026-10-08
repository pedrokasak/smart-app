import { Inject, Injectable } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	type MarketAssetType,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	computeCorrelationMatrix,
	type CorrelationMatrixResult,
} from 'src/portfolio/history/asset-correlation';
import { PortfolioService } from 'src/portfolio/portfolio.service';

/**
 * Matriz de correlação das maiores posições, para o card do nível avançado na
 * seção "Performance e risco" (TRA-274).
 *
 * O cálculo é o mesmo do Copiloto (`computeCorrelationMatrix`, pareado por
 * data); aqui só muda o recorte: as seis maiores posições a valor de mercado,
 * porque uma matriz maior deixa de caber e de ser legível na tela.
 */

/** Seis cabem lado a lado no card; o protótipo aprovado usa seis. */
const MATRIX_SIZE = 6;
/** Tipos com fechamento diário. Renda fixa e fundo não têm. */
const PRICED_TYPES = new Set(['stock', 'fii', 'etf', 'crypto']);

@Injectable()
export class PortfolioCorrelationService {
	constructor(
		private readonly portfolioService: PortfolioService,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	async getCorrelation(userId: string): Promise<CorrelationMatrixResult> {
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = (portfolios || []).flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		// Valor a MERCADO; `total` é custo de aquisição.
		const bySymbol = new Map<string, { type: string; marketValue: number }>();
		for (const asset of assets) {
			const symbol = String(asset?.symbol || '').toUpperCase();
			const type = String(asset?.type || 'other');
			const quantity = Number(asset?.quantity) || 0;
			const price = Number(asset?.currentPrice) || Number(asset?.price) || 0;
			if (!symbol || !PRICED_TYPES.has(type) || !(quantity * price > 0))
				continue;
			bySymbol.set(symbol, {
				type,
				marketValue:
					(bySymbol.get(symbol)?.marketValue || 0) + quantity * price,
			});
		}

		const selected = [...bySymbol.entries()]
			.sort((a, b) => b[1].marketValue - a[1].marketValue)
			.slice(0, MATRIX_SIZE);

		const closes = await Promise.all(
			selected.map(
				async ([symbol, entry]) =>
					[
						symbol,
						await this.marketData.getDailyCloses(
							symbol,
							'1y',
							entry.type as MarketAssetType
						),
					] as const
			)
		);

		return computeCorrelationMatrix(Object.fromEntries(closes));
	}
}
