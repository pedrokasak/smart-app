export type FundamentalKey =
	| 'roic'
	| 'netMargin'
	| 'netDebt'
	| 'payout'
	| 'priceEarnings'
	| 'priceToBook'
	| 'evEbitda'
	| 'returnOnEquity';

export type FundamentalSource = 'brapi' | 'fundamentus' | 'yahoo' | 'derived';

export type FundamentalStatus = 'ok' | 'unavailable' | 'not_applicable';

export interface FundamentalValue {
	status: FundamentalStatus;

	/**
	 * UNIDADE — contrato explicito, nao inferivel do numero.
	 *
	 * `value` esta em PONTOS PERCENTUAIS para os indicadores percentuais
	 * (`roic`, `netMargin`, `payout`, `returnOnEquity`): `'16,6%'` na fonte
	 * chega aqui como `16.6`, e nao como `0.166`. Quem exibe formata como
	 * `${value}%` — NAO multiplica por 100.
	 *
	 * Isso diverge de proposito da outra convencao viva no repositorio.
	 * `StockService.getFundamentusValue` e `TrackerrMarketDataFacade
	 * .findNumericValue` usam `treatAsPercent` e devolvem FRACAO (`0.166`), e
	 * `trackerr-score.service.ts` le nessa convencao. As duas convivem: os
	 * caminhos antigos nao mudam, e `FundamentalValue` e um tipo novo, so
	 * consumido pelo bloco `fundamentals` da cotacao nacional.
	 *
	 * Aplicar a convencao antiga a este campo renderiza `16.6` como "1660%".
	 * Se um consumidor novo precisar de fracao, converte na borda dele.
	 *
	 * Os nao percentuais carregam a unidade natural: `netDebt` em reais
	 * absolutos (negativo = caixa liquido), `priceEarnings`, `priceToBook` e
	 * `evEbitda` como multiplos adimensionais.
	 */
	value: number | null;

	source: FundamentalSource | null;
}

export interface FundamentalsResult {
	symbol: string;
	sector: string | null;
	mixed: boolean;
	values: Record<FundamentalKey, FundamentalValue>;
}

export const FUNDAMENTAL_KEYS: readonly FundamentalKey[] = [
	'roic',
	'netMargin',
	'netDebt',
	'payout',
	'priceEarnings',
	'priceToBook',
	'evEbitda',
	'returnOnEquity',
];
