/**
 * Parser do COTAHIST, a série histórica diária da B3 (TRA-251).
 *
 * Layout fixo de 245 colunas por linha, em ISO-8859-1. Posições abaixo são
 * as do layout oficial (1-based no manual, 0-based aqui):
 *
 *   TIPREG  1-2    "00" cabeçalho, "01" cotação, "99" rodapé
 *   DATA    3-10   AAAAMMDD do pregão
 *   CODBDI  11-12  tipo de papel (02 lote padrão, 12 FII, 14 ETF...)
 *   CODNEG  13-24  código de negociação (PETR4, HGLG11, BOVA11)
 *   TPMERC  25-27  010 mercado à vista, 020 fracionário, 070/080 opções...
 *   PREABE  57-69  abertura  (13 dígitos, 2 casas implícitas)
 *   PREMAX  70-82  máxima
 *   PREMIN  83-95  mínima
 *   PREULT  109-121 último negócio do dia = fechamento
 *   TOTNEG  148-152 número de negócios
 *   VOLTOT  171-188 volume financeiro (2 casas implícitas)
 *   FATCOT  211-217 fator de cotação (preço é por FATCOT unidades)
 *
 * O preço é o do pregão, SEM ajuste por desdobramento, grupamento ou
 * dividendo: é o que estava na tela naquele dia, certo para "valor a
 * mercado em D", mas quem calcula retorno precisa tratar o salto de um
 * desdobramento (ver `asset-beta.ts`).
 */

export interface CotahistQuote {
	symbol: string;
	/** YYYY-MM-DD. */
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	trades: number;
}

export const COTAHIST_LINE_LENGTH = 245;

/** Só o mercado à vista: opções, termo e fracionário têm outro código/preço. */
const SPOT_MARKET = '010';
const QUOTE_RECORD = '01';

function slice(line: string, from: number, to: number): string {
	return line.slice(from, to);
}

function priceCents(raw: string): number | null {
	if (!/^\d+$/.test(raw)) return null;
	return Number(raw) / 100;
}

function isoDate(raw: string): string | null {
	if (!/^\d{8}$/.test(raw)) return null;
	const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
	const date = new Date(`${iso}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso
		? null
		: iso;
}

/** `null` para cabeçalho, rodapé, outro mercado ou linha malformada. */
export function parseCotahistLine(line: string): CotahistQuote | null {
	if (line.length < COTAHIST_LINE_LENGTH - 5) return null;
	if (slice(line, 0, 2) !== QUOTE_RECORD) return null;
	if (slice(line, 24, 27) !== SPOT_MARKET) return null;

	const symbol = slice(line, 12, 24).trim().toUpperCase();
	const date = isoDate(slice(line, 2, 10));
	const close = priceCents(slice(line, 108, 121));
	if (!symbol || !date || close === null || close <= 0) return null;

	// Papel cotado por lote (FATCOT > 1): o preço é do lote, não da unidade.
	const factorRaw = slice(line, 210, 217);
	const factor = /^\d+$/.test(factorRaw) ? Number(factorRaw) : 1;
	const perUnit = factor > 1 ? factor : 1;

	const cents = (from: number, to: number) =>
		(priceCents(slice(line, from, to)) ?? 0) / perUnit;
	const integer = (from: number, to: number) => {
		const raw = slice(line, from, to);
		return /^\d+$/.test(raw) ? Number(raw) : 0;
	};

	return {
		symbol,
		date,
		open: cents(56, 69),
		high: cents(69, 82),
		low: cents(82, 95),
		close: close / perUnit,
		volume: priceCents(slice(line, 170, 188)) ?? 0,
		trades: integer(147, 152),
	};
}

/**
 * Lê as linhas e devolve as cotações. `only` restringe aos símbolos
 * pedidos: o arquivo anual tem mais de um milhão de linhas e só interessa o
 * que alguém carrega em carteira (limite de armazenamento da TRA-251).
 */
export async function* parseCotahist(
	lines: AsyncIterable<string> | Iterable<string>,
	only?: ReadonlySet<string>
): AsyncGenerator<CotahistQuote> {
	for await (const line of lines) {
		const quote = parseCotahistLine(line);
		if (!quote) continue;
		if (only && !only.has(quote.symbol)) continue;
		yield quote;
	}
}
