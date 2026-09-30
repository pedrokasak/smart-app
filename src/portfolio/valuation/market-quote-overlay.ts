/**
 * Marcação a mercado das posições na leitura (TRA-247).
 *
 * O preço gravado no ativo é o da importação (ex.: fechamento de 30/12/2025
 * do consolidado anual da B3) ou o da compra manual. A varredura de cotações
 * já grava a última leitura por símbolo em `quote_freshness`, mas a carteira
 * nunca a lia: a tabela mostrava R$ 25,33 para VBBR3 enquanto a página do
 * ativo, que busca ao vivo, mostrava R$ 37,21 — e resultado, posição e peso
 * saíam do preço velho.
 *
 * Regra: a leitura mais recente vence, e o valor da posição passa a ser
 * quantidade × cotação sempre que houver cotação. Renda fixa e "outros" não
 * têm cotação de mercado e ficam como estão.
 */

export interface QuotableAsset {
	symbol: string;
	type?: string;
	quantity: number;
	price: number;
	total: number;
	currentPrice?: number;
	/** Quando `currentPrice` foi lido na fonte. */
	currentPriceAt?: Date | string;
	lastEnrichedAt?: Date | string;
	quoteAsOf?: string;
	quoteSource?: string;
}

export interface LatestQuote {
	symbol: string;
	lastQuoteAt: Date;
	lastPrice?: number | null;
	source?: string | null;
}

// Só a cadeia de mercado alimenta o cache por símbolo lido aqui. Cripto é
// cotada pela CoinGecko direto na posição; o cache chegou a guardar um papel
// homônimo para "LUNC" (TRA-252).
const MARKET_QUOTED = new Set(['stock', 'fii', 'etf']);

const toTime = (value: Date | string | undefined): number => {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
};

export function applyLatestQuotes<T extends QuotableAsset>(
	assets: T[],
	quotes: LatestQuote[]
): T[] {
	const bySymbol = new Map(
		quotes
			.filter((quote) => Number(quote.lastPrice) > 0)
			.map((quote) => [String(quote.symbol).toUpperCase(), quote])
	);

	return assets.map((asset) => {
		if (!MARKET_QUOTED.has(String(asset.type))) return asset;

		const quote = bySymbol.get(String(asset.symbol).toUpperCase());
		const ownQuoteAt = asset.currentPriceAt ?? asset.lastEnrichedAt;
		const quoteIsNewer =
			!!quote &&
			(!(Number(asset.currentPrice) > 0) ||
				toTime(quote.lastQuoteAt) >= toTime(ownQuoteAt));

		const next: T = quoteIsNewer
			? {
					...asset,
					currentPrice: Number(quote.lastPrice),
					quoteAsOf: new Date(quote.lastQuoteAt).toISOString(),
					quoteSource: quote.source ?? undefined,
				}
			: asset.currentPriceAt && Number(asset.currentPrice) > 0
				? { ...asset, quoteAsOf: new Date(asset.currentPriceAt).toISOString() }
				: asset;

		const marketPrice = Number(next.currentPrice);
		const quantity = Number(next.quantity);
		if (!(marketPrice > 0) || !Number.isFinite(quantity)) return next;

		return { ...next, total: roundCents(quantity * marketPrice) };
	});
}

function roundCents(value: number): number {
	return Math.round(value * 100) / 100;
}
