/**
 * Pergunta de seguimento (ADR-007, fase 2): "e a VALE3?" logo depois de
 * "Quanto a PETR4 pagou de dividendos?" quer dizer "Quanto a VALE3 pagou de
 * dividendos?". O orquestrador classifica cada pergunta sozinha, então a
 * pergunta curta é reescrita aqui com a anterior da mesma conversa.
 *
 * Só reescreve o caso claro: começa com "e", é curta, traz ticker e a
 * pergunta anterior também trazia. Em qualquer outro caso, devolve a
 * pergunta como veio.
 */

const TICKER = /\b[A-Z]{4}\d{1,2}\b/g;
const FOLLOW_UP_START =
	/^\s*e\s+(?:(?:o|a|os|as|do|da|no|na|sobre|quanto\s+a|quanto\s+ao)\s+)?/i;
const FOLLOW_UP_MAX_CHARS = 60;

export function resolveFollowUpQuestion(
	question: string,
	previousQuestion: string | null | undefined
): string {
	const current = String(question || '').trim();
	const previous = String(previousQuestion || '').trim();
	if (!previous || current.length > FOLLOW_UP_MAX_CHARS) return current;
	if (!FOLLOW_UP_START.test(current)) return current;

	const newTickers = current.toUpperCase().match(TICKER) ?? [];
	const oldTickers = previous.match(TICKER) ?? [];
	if (!newTickers.length || !oldTickers.length) return current;

	// Troca os tickers da pergunta anterior, na ordem; sobrando ticker novo,
	// todos os antigos viram o primeiro novo.
	let index = 0;
	return previous.replace(TICKER, () => {
		const next = newTickers[Math.min(index, newTickers.length - 1)];
		index += 1;
		return next;
	});
}
