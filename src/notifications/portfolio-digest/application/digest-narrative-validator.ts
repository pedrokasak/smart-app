import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

const TICKER_PATTERN = /\b[A-Z]{4}\d{1,2}\b/g;
const MAX_LENGTH = 600;

// Verbo de recomendacao explicito. Deliberadamente NAO inclui "aporte" —
// termo legitimo do produto (ex: "Aporte Mensal" no simulador) que so vira
// problema como verbo de instrucao ("aporte em X agora"), o que os outros
// termos ja cobrem com menos falso positivo.
const RECOMMENDATION_PATTERN =
	/\b(compre|comprar|venda|vender|recomendo|recomendamos|recomendacao|invista|investir)\b/i;

export interface DigestNarrativeValidationResult {
	valid: boolean;
	reason?: 'empty' | 'too_long' | 'unknown_ticker' | 'recommendation_language';
}

/**
 * Todo dado citado (ticker) precisa existir nos fatos que o NestJS mandou;
 * nenhum verbo de recomendacao. Falhou em qualquer checagem -> narrativa
 * descartada, chamador cai no fallback deterministico. Esta e a garantia
 * de "nunca recomendar" em codigo, nao em prompt (TRA-10).
 */
export function validateDigestNarrative(
	text: string,
	facts: PortfolioDigestFacts
): DigestNarrativeValidationResult {
	const trimmed = String(text || '').trim();
	if (!trimmed) return { valid: false, reason: 'empty' };
	if (trimmed.length > MAX_LENGTH) return { valid: false, reason: 'too_long' };
	if (RECOMMENDATION_PATTERN.test(trimmed)) {
		return { valid: false, reason: 'recommendation_language' };
	}

	const knownSymbols = new Set<string>([
		...facts.topGainers.map((mover) => mover.symbol),
		...facts.topLosers.map((mover) => mover.symbol),
		...facts.watchItems.map((item) => item.symbol),
	]);

	const mentionedTickers = trimmed.match(TICKER_PATTERN) || [];
	for (const ticker of mentionedTickers) {
		if (!knownSymbols.has(ticker)) {
			return { valid: false, reason: 'unknown_ticker' };
		}
	}

	return { valid: true };
}
