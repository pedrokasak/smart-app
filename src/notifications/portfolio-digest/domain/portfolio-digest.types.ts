/**
 * Razao pela qual um ativo entrou em watchItems. Enum fechado de proposito:
 * toda razao e um fato sobre a carteira do proprio usuario, nunca um juizo
 * sobre o ativo ("esse ativo esta bom/ruim"). E a propriedade que garante
 * que o digest nunca vira recomendacao, mesmo antes de qualquer validacao
 * de narrativa (ver TRA-10).
 *
 * 'concentration_above_threshold' usa os mesmos limiares deterministicos do
 * PortfolioErrorRadarService (TRA-7) — nao a meta de alocacao que o usuario
 * define no web, que so existe em localStorage e nunca foi persistida no
 * server.
 */
export type DigestWatchReason =
	| 'concentration_above_threshold'
	| 'below_average_cost';

export interface DigestMover {
	symbol: string;
	/** Variacao no dia do envio (changePercent24h do snapshot de mercado), nao da semana — ver detail. */
	changePercent: number;
}

export interface DigestWatchItem {
	symbol: string;
	reason: DigestWatchReason;
	detail: string;
}

export interface PortfolioDigestFacts {
	periodStart: string;
	periodEnd: string;
	/** null = sem dado, nunca 0 como placeholder de carteira vazia. */
	portfolioValue: number | null;
	periodChangePct: number | null;
	periodChangeAbs: number | null;
	/** Ate 3, ordenados por changePercent desc. */
	topGainers: DigestMover[];
	/** Ate 3, ordenados por changePercent asc. */
	topLosers: DigestMover[];
	/** Ate 3. */
	watchItems: DigestWatchItem[];
	/** Soma de dividendHistory no periodo. null = sem dado. */
	dividendsReceived: number | null;
	hasSufficientData: boolean;
}
