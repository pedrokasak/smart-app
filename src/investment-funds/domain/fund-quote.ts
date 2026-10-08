/**
 * Cota diária de uma classe (ou subclasse) de fundo, como a CVM publica no
 * Informe Diário (TRA-276). Datas em `YYYY-MM-DD` (competência), valores em
 * reais como vêm na fonte.
 */
export interface FundQuote {
	/** 14 dígitos do CNPJ da classe. */
	cnpj: string;
	/** `ID_SUBCLASSE`; `null` quando a cota é da classe. */
	subclassId: string | null;
	date: string;
	quota: number;
	netAssetValue: number | null;
	investorCount: number | null;
}

export const fundQuoteKey = (cnpj: string, subclassId: string | null) =>
	subclassId ? `${cnpj}:${subclassId}` : cnpj;

/** Cota com data igual ou posterior substitui; mais antiga nunca. */
export function isSameOrNewer(
	candidate: Pick<FundQuote, 'date'>,
	current: Pick<FundQuote, 'date'> | null | undefined
): boolean {
	return !current || candidate.date >= current.date;
}
