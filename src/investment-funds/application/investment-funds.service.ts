import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { formatCnpj, normalizeCnpj } from '../domain/cnpj';
import type { InvestmentFundClass } from '../domain/fund-class';
import {
	INVESTMENT_FUND_STORE,
	InvestmentFundStore,
	StoredFundQuote,
} from './ports/investment-funds.ports';

export const SEARCH_LIMIT = 20;
export const CVM_SOURCE_LABEL = 'CVM — Informe Diário';

export interface FundQuoteView {
	date: string;
	quota: number;
	netAssetValue: number | null;
	investorCount: number | null;
	source: string;
	sourceUrl: string;
}

export interface InvestmentFundView extends InvestmentFundClass {
	cnpjFormatted: string;
	/** `null` quando a CVM ainda não publicou cota desta classe. */
	latestQuote: FundQuoteView | null;
}

/** Cota no formato que a marcação a mercado da carteira consome. */
export interface FundMarketQuote {
	symbol: string;
	lastQuoteAt: Date;
	lastPrice: number;
	source: string;
}

const toQuoteView = (quote: StoredFundQuote): FundQuoteView => ({
	date: quote.date,
	quota: quote.quota,
	netAssetValue: quote.netAssetValue,
	investorCount: quote.investorCount,
	source: CVM_SOURCE_LABEL,
	sourceUrl: quote.sourceUrl,
});

/** Competência `YYYY-MM-DD` como meia-noite de Brasília. */
export const quoteDateToInstant = (date: string) =>
	new Date(`${date}T00:00:00-03:00`);

/**
 * Consulta dos fundos (TRA-276): busca no cadastro da CVM e última cota.
 * Leitura pura do que os jobs gravaram — nenhuma chamada à CVM no caminho da
 * requisição.
 */
@Injectable()
export class InvestmentFundsService {
	constructor(
		@Inject(INVESTMENT_FUND_STORE)
		private readonly store: InvestmentFundStore
	) {}

	async search(query: string): Promise<InvestmentFundView[]> {
		const classes = await this.store.searchClasses(query.trim(), SEARCH_LIMIT);
		return this.withQuotes(classes);
	}

	async getFund(rawCnpj: string): Promise<InvestmentFundView> {
		const cnpj = normalizeCnpj(rawCnpj);
		if (!cnpj) throw new BadRequestException('CNPJ inválido.');
		const fundClass = await this.store.findClass(cnpj);
		if (!fundClass) {
			throw new NotFoundException('Fundo não encontrado no cadastro da CVM.');
		}
		const [view] = await this.withQuotes([fundClass]);
		return view;
	}

	/**
	 * Valida o CNPJ de uma posição nova e devolve símbolo (14 dígitos) e nome
	 * oficial. Só aceita classe que está no cadastro: é o que garante que a
	 * posição vai receber cota.
	 */
	async resolveForNewPosition(
		symbol: string
	): Promise<{ symbol: string; name: string }> {
		const fund = await this.getFund(symbol);
		return { symbol: fund.cnpj, name: fund.name };
	}

	/** Última cota positiva de cada CNPJ pedido; símbolo que não é CNPJ é ignorado. */
	async marketQuotes(symbols: string[]): Promise<FundMarketQuote[]> {
		const cnpjs = [
			...new Set(symbols.map(normalizeCnpj).filter((v): v is string => !!v)),
		];
		const quotes = await this.store.findClassQuotes(cnpjs);
		return quotes
			.filter((quote) => quote.quota > 0)
			.map((quote) => ({
				symbol: quote.cnpj,
				lastQuoteAt: quoteDateToInstant(quote.date),
				lastPrice: quote.quota,
				source: CVM_SOURCE_LABEL,
			}));
	}

	private async withQuotes(
		classes: InvestmentFundClass[]
	): Promise<InvestmentFundView[]> {
		const quotes = await this.store.findClassQuotes(
			classes.map((item) => item.cnpj)
		);
		const byCnpj = new Map(quotes.map((quote) => [quote.cnpj, quote]));
		return classes.map((item) => {
			const quote = byCnpj.get(item.cnpj);
			return {
				...item,
				cnpjFormatted: formatCnpj(item.cnpj),
				latestQuote: quote ? toQuoteView(quote) : null,
			};
		});
	}
}
