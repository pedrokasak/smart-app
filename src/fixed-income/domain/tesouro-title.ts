/**
 * Títulos do Tesouro Direto lidos do Tesouro Transparente (TRA-269).
 *
 * Só entram os três que pagam tudo no vencimento — Selic (LFT), Prefixado
 * (LTN) e IPCA+ (NTN-B Principal) —, porque o IR do resgate incide uma vez
 * sobre o ganho total e a taxa de compra é a rentabilidade da carteira
 * inteira. Ficam de fora:
 *  - as versões com cupom semestral: o IR de cada cupom segue a própria
 *    faixa e o retorno depende da reaplicação, o que pede outro modelo;
 *  - Renda+ e Educa+: pagam uma renda mensal depois de um período de
 *    acumulação, não são comparáveis a um prazo único;
 *  - IGP-M+: o título não está à venda para pessoa física.
 */

export type TesouroFamily = 'SELIC' | 'PREFIXED' | 'IPCA_PLUS';

/** Ordem em que as famílias aparecem na tabela. */
export const TESOURO_FAMILY_ORDER: readonly TesouroFamily[] = [
	'SELIC',
	'PREFIXED',
	'IPCA_PLUS',
];

/** Nome do tipo no CSV → família. */
export const TESOURO_CSV_TYPES: Readonly<Record<string, TesouroFamily>> = {
	'Tesouro Selic': 'SELIC',
	'Tesouro Prefixado': 'PREFIXED',
	'Tesouro IPCA+': 'IPCA_PLUS',
};

export interface TesouroTitle {
	/** `FAMILIA:AAAA-MM-DD` do vencimento — estável entre dias. */
	id: string;
	family: TesouroFamily;
	/** Ex.: "Tesouro IPCA+ 2035". */
	name: string;
	/** YYYY-MM-DD */
	maturityDate: string;
	/**
	 * Taxa de compra da manhã, em % a.a. Na Selic é o spread sobre a Selic; no
	 * Prefixado, a taxa nominal; no IPCA+, o juro real.
	 */
	buyRatePct: number;
	sellRatePct: number;
	/** Preço unitário de compra, em R$. */
	unitPrice: number;
	/** Pregão a que a taxa se refere (YYYY-MM-DD). */
	baseDate: string;
}

export const TESOURO_ID_PATTERN =
	/^(SELIC|PREFIXED|IPCA_PLUS):\d{4}-\d{2}-\d{2}$/;

export function tesouroTitleId(
	family: TesouroFamily,
	maturityDate: string
): string {
	return `${family}:${maturityDate}`;
}

export function tesouroTitleName(
	csvType: string,
	maturityDate: string
): string {
	return `${csvType} ${maturityDate.slice(0, 4)}`;
}
