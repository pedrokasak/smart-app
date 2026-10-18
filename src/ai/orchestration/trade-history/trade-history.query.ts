/**
 * Consulta do histórico de operações pedido no chat (ADR-002, TRA-16, fase 2).
 *
 * Só o TICKER pode vir do roteador com LLM. Período e lado saem da pergunta
 * por código, como o valor de aporte e a quantidade nas outras ferramentas:
 * o modelo nunca preenche número nem data.
 */
export type TradeSide = 'buy' | 'sell';

export interface TradeHistoryQuery {
	symbol?: string;
	side?: TradeSide;
	/** YYYY-MM-DD, inclusivo. */
	from?: string;
	/** YYYY-MM-DD, inclusivo. */
	to?: string;
	/** Rótulo do período como a pessoa pediu ("2025", "este ano"), para a resposta. */
	periodLabel?: string;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) =>
	new Date(Date.UTC(year, month, day));

function parsePeriod(
	text: string,
	today: Date
): Pick<TradeHistoryQuery, 'from' | 'to' | 'periodLabel'> {
	const year = today.getUTCFullYear();
	const month = today.getUTCMonth();

	if (/\b(ano passado|ano anterior)\b/.test(text)) {
		return {
			from: iso(utc(year - 1, 0, 1)),
			to: iso(utc(year - 1, 11, 31)),
			periodLabel: String(year - 1),
		};
	}
	if (/\b(este|neste|esse|nesse) ano\b|\bano atual\b|\bno ano\b/.test(text)) {
		return {
			from: iso(utc(year, 0, 1)),
			to: iso(today),
			periodLabel: String(year),
		};
	}
	if (/\bm[eê]s passado\b/.test(text)) {
		const start = utc(year, month - 1, 1);
		const end = utc(year, month, 0);
		return {
			from: iso(start),
			to: iso(end),
			periodLabel: `${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
		};
	}
	if (/\b(este|neste|esse|nesse) m[eê]s\b/.test(text)) {
		return {
			from: iso(utc(year, month, 1)),
			to: iso(today),
			periodLabel: `${String(month + 1).padStart(2, '0')}/${year}`,
		};
	}
	// Sem `\b` antes de "ú": o JavaScript não a trata como letra de palavra.
	const lastMonths = text.match(/[uú]ltimos? (\d{1,2}) m[eê]s(?:es)?\b/);
	if (lastMonths) {
		const months = Math.min(Number(lastMonths[1]), 60);
		if (months > 0) {
			return {
				from: iso(utc(year, month - months, today.getUTCDate())),
				to: iso(today),
				periodLabel: `últimos ${months} meses`,
			};
		}
	}
	const explicitYear = text.match(/\b(20\d{2})\b/);
	if (explicitYear) {
		const y = Number(explicitYear[1]);
		if (y <= year) {
			return {
				from: iso(utc(y, 0, 1)),
				to: iso(utc(y, 11, 31)),
				periodLabel: String(y),
			};
		}
	}
	return {};
}

function parseSide(text: string): TradeSide | undefined {
	const buy = /\b(comprei|compras?|comprado|comprados|comprou)\b/.test(text);
	const sell = /\b(vendi|vendas?|vendido|vendidos|vendeu)\b/.test(text);
	if (buy && !sell) return 'buy';
	if (sell && !buy) return 'sell';
	return undefined;
}

export function parseTradeHistoryQuery(
	question: string,
	symbols: readonly string[],
	today: Date = new Date()
): TradeHistoryQuery {
	const text = String(question || '').toLowerCase();
	const query: TradeHistoryQuery = { ...parsePeriod(text, today) };
	const side = parseSide(text);
	if (side) query.side = side;
	if (symbols[0]) query.symbol = String(symbols[0]).toUpperCase();
	return query;
}
