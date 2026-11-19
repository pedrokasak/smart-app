import { Inject, Injectable } from '@nestjs/common';
import { InvestmentFundsService } from 'src/investment-funds/application/investment-funds.service';
import { INVESTMENT_FUND_ASSET_TYPE } from 'src/investment-funds/domain/investment-fund-asset';
import {
	QUOTE_FRESHNESS_STORE,
	QuoteFreshnessStore,
} from 'src/market-data/quote-staleness/application/ports/quote-freshness.port';
import { applyLatestQuotes } from './market-quote-overlay';

/**
 * Marcação a mercado com a última cotação lida por símbolo (TRA-247).
 * Sem ela, posição, resultado e peso saíam do preço da importação, e toda rota
 * que devolve ativos precisa dar o mesmo número. Falha ao ler o cache não
 * derruba a carteira: fica o preço gravado.
 *
 * Fundo (`investment_fund`) é cotado pela cota diária da CVM (TRA-276), não pela
 * varredura de mercado: o símbolo dele é o CNPJ da classe.
 */
@Injectable()
export class PortfolioMarkToMarketService {
	constructor(
		@Inject(QUOTE_FRESHNESS_STORE)
		private readonly quoteFreshness: QuoteFreshnessStore,
		private readonly investmentFunds: InvestmentFundsService
	) {}

	async apply<T extends Parameters<typeof applyLatestQuotes>[0][number]>(
		assets: T[]
	): Promise<T[]> {
		if (!assets.length) return assets;
		const fundSymbols = assets
			.filter((asset) => asset.type === INVESTMENT_FUND_ASSET_TYPE)
			.map((asset) => asset.symbol);
		const marketSymbols = assets
			.filter((asset) => asset.type !== INVESTMENT_FUND_ASSET_TYPE)
			.map((asset) => asset.symbol);

		const [marketQuotes, fundQuotes] = await Promise.all([
			marketSymbols.length
				? this.quoteFreshness.findBySymbols(marketSymbols).catch(() => [])
				: [],
			fundSymbols.length
				? this.investmentFunds.marketQuotes(fundSymbols).catch(() => [])
				: [],
		]);
		return applyLatestQuotes(assets, [...marketQuotes, ...fundQuotes]);
	}
}
