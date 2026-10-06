import type { VerdictFacts } from './verdict-facts';

const MAX_LENGTH = 700;

/** Tolerância para a IA arredondar ("12,8%" para 12,77%): 0,05 ou 0,05%. */
const ABSOLUTE_TOLERANCE = 0.05;
const RELATIVE_TOLERANCE = 0.0005;

// Verbo que manda a pessoa fazer algo com o dinheiro. "Venda" fica de fora de
// propósito: é substantivo legítimo ("venda antes do vencimento").
const RECOMMENDATION_PATTERN =
	/\b(compre|comprar|invista|investir|aplique|aplicar|recomendo|recomendamos|recomenda|recomendação|recomendacao|sugiro|sugerimos|aconselho)\b/i;

const TESOURO_MENTION_PATTERN =
	/Tesouro (?:Selic|Prefixado|IPCA\+)(?: \d{4})?/g;
// Produto de investimento citado no texto. Só vale se aparecer nos fatos: a IA
// adora lembrar da poupança ou de "uma LCA equivalente", que não estão na tabela.
const PRODUCT_WORD_PATTERN =
	/\b(CDB|LCI|LCA|CRI|CRA|LC|debêntures?|poupança|poupanca|fundos?|ações|acoes|FIIs?|LFT|LTN|NTN-?B)\b/gi;
const NUMBER_PATTERN = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

export type VerdictRejection =
	| 'empty'
	| 'too_long'
	| 'recommendation_language'
	| 'unknown_number'
	| 'unknown_instrument'
	| 'unknown_product'
	| 'missing_winner';

export interface VerdictValidation {
	valid: boolean;
	reason?: VerdictRejection;
}

function parseNumberToken(token: string): number {
	if (token.includes(',')) {
		return Number(token.replace(/\./g, '').replace(',', '.'));
	}
	// Só pontos: "1.234" é milhar; "13.65" é decimal.
	if (/^\d{1,3}(\.\d{3})+$/.test(token))
		return Number(token.replace(/\./g, ''));
	return Number(token);
}

/** Números de um texto em português ("1.234,56", "13,65", "13.65"). */
export function extractNumbers(text: string): number[] {
	return (text.match(NUMBER_PATTERN) ?? []).map(parseNumberToken);
}

function allowedNumbers(facts: VerdictFacts): number[] {
	const { scenario, ranking, points } = facts;
	return [
		scenario.principal,
		scenario.years,
		scenario.cdiPct,
		scenario.ipcaPct,
		scenario.irRatePct,
		ranking.length,
		...ranking.flatMap((row) => [
			row.grossAnnualPct,
			row.netAnnualPct,
			row.realAnnualPct,
			row.netFinal,
			// O nome carrega taxa e ano ("CDB 110% do CDI", "Tesouro IPCA+ 2035").
			...extractNumbers(row.name),
		]),
		...points.flatMap(extractNumbers),
	];
}

const isAllowed = (value: number, allowed: number[]) =>
	allowed.some(
		(candidate) =>
			Math.abs(candidate - value) <=
			Math.max(ABSOLUTE_TOLERANCE, Math.abs(candidate) * RELATIVE_TOLERANCE)
	);

/**
 * O trackerr-ia é tratado como não confiável: o texto só vale se todo número
 * existir nos fatos enviados, todo título do Tesouro citado estiver na tabela,
 * o vencedor aparecer pelo nome e não houver verbo de recomendação. Falhou em
 * qualquer um → o chamador cai no texto determinístico. É a garantia de "a IA
 * nunca discorda da tabela" em código, não em prompt.
 */
export function validateVerdictText(
	text: unknown,
	facts: VerdictFacts
): VerdictValidation {
	const trimmed = typeof text === 'string' ? text.trim() : '';
	if (!trimmed) return { valid: false, reason: 'empty' };
	if (trimmed.length > MAX_LENGTH) return { valid: false, reason: 'too_long' };
	if (RECOMMENDATION_PATTERN.test(trimmed)) {
		return { valid: false, reason: 'recommendation_language' };
	}

	const names = facts.ranking.map((row) => row.name);
	for (const mention of trimmed.match(TESOURO_MENTION_PATTERN) ?? []) {
		if (!names.some((name) => name.startsWith(mention))) {
			return { valid: false, reason: 'unknown_instrument' };
		}
	}

	const knownText = [...names, ...facts.points].join(' ').toLowerCase();
	// Tipo explícito: sem strictNullChecks, `match(...) ?? []` vira uma união de
	// arrays em que `word` é inferido como `never`.
	const productWords: string[] = trimmed.match(PRODUCT_WORD_PATTERN) ?? [];
	const mentionsUnknownProduct = productWords.some(
		(word) => !knownText.includes(word.toLowerCase())
	);
	if (mentionsUnknownProduct) {
		return { valid: false, reason: 'unknown_product' };
	}

	const allowed = allowedNumbers(facts);
	if (extractNumbers(trimmed).some((value) => !isAllowed(value, allowed))) {
		return { valid: false, reason: 'unknown_number' };
	}

	if (facts.ranking.length > 0 && !trimmed.includes(facts.ranking[0].name)) {
		return { valid: false, reason: 'missing_winner' };
	}
	return { valid: true };
}
