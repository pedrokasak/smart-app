/**
 * IR sobre renda fixa para pessoa física (TRA-269).
 *
 * Aqui só entram constantes LEGAIS — a tabela regressiva (Lei 11.033/2004) e a
 * lista de produtos isentos. Taxa de mercado nunca mora neste módulo: vem do
 * BACEN, do Tesouro Transparente ou da pessoa que está simulando.
 */

export const BANK_INSTRUMENT_KINDS = [
	'CDB',
	'LC',
	'LCI',
	'LCA',
	'CRI',
	'CRA',
	'DEBENTURE',
	'DEBENTURE_INCENTIVADA',
] as const;
export type BankInstrumentKind = (typeof BANK_INSTRUMENT_KINDS)[number];

/** `TESOURO` vem do Tesouro Direto; `REFERENCIA` é o próprio CDI. */
export type InstrumentKind = BankInstrumentKind | 'TESOURO' | 'REFERENCIA';

/**
 * Isentos de IR para pessoa física: LCI, LCA, CRI e CRA (Lei 11.033/2004) e
 * debêntures incentivadas de infraestrutura (Lei 12.431/2011).
 */
const TAX_EXEMPT_KINDS: ReadonlySet<InstrumentKind> = new Set([
	'LCI',
	'LCA',
	'CRI',
	'CRA',
	'DEBENTURE_INCENTIVADA',
]);

export function isTaxExempt(kind: InstrumentKind): boolean {
	return TAX_EXEMPT_KINDS.has(kind);
}

/** Faixas em dias corridos desde a aplicação; o limite é inclusivo. */
export const REGRESSIVE_TAX_BRACKETS: ReadonlyArray<{
	upToDays: number;
	ratePct: number;
}> = [
	{ upToDays: 180, ratePct: 22.5 },
	{ upToDays: 360, ratePct: 20 },
	{ upToDays: 720, ratePct: 17.5 },
	{ upToDays: Number.POSITIVE_INFINITY, ratePct: 15 },
];

/** Alíquota (em %) do IR regressivo para um resgate após `days` dias corridos. */
export function regressiveTaxRatePct(days: number): number {
	const bracket = REGRESSIVE_TAX_BRACKETS.find(
		(candidate) => days <= candidate.upToDays
	);
	// A última faixa é infinita, então `find` nunca devolve undefined.
	return (bracket as { ratePct: number }).ratePct;
}
