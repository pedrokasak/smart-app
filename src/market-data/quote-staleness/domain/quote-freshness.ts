/**
 * Frescor de cotacao por simbolo (TRA-136, fase 7).
 *
 * O dominio inteiro desta feature cabe aqui: um registro por simbolo com o
 * instante da ULTIMA LEITURA BEM-SUCEDIDA, e a conta de quanto tempo faz.
 *
 * O que este arquivo existe para NAO ser: uma reciclagem de
 * `Asset.lastEnrichedAt`. Aquele campo marca quando o ativo foi enriquecido
 * ao entrar na carteira; nao ha job que o renove, entao trata-lo como
 * "ultima cotacao" alertaria todo ativo um dia depois de cadastrado — o
 * dado nao estaria velho, e que nunca teria havido uma segunda leitura.
 * Aqui o carimbo so e escrito quando uma leitura de fato retornou preco.
 */

/** Um simbolo e o instante da ultima leitura de cotacao bem-sucedida. */
export interface QuoteFreshnessRecord {
	symbol: string;
	/** Instante em que a fonte respondeu com preco. Nunca "quando gravamos". */
	lastQuoteAt: Date;
	/** Ultimo preco lido. So diagnostico — a decisao nao depende dele. */
	lastPrice?: number | null;
	/** Quem respondeu (`primary`, `fallback_fundamentus`, ...). Diagnostico. */
	source?: string | null;
}

export interface QuoteStalenessReading {
	symbol: string;
	lastQuoteAt: Date;
	minutesSinceLastQuote: number;
}

/** Normalizacao unica do simbolo. Chave do registro e escopo da regra. */
export function normalizeSymbol(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toUpperCase();
}

/**
 * Leitura de frescor de um registro. Devolve `null` quando nao ha o que
 * medir — e essa a diferenca entre honesto e conveniente.
 *
 * Registro AUSENTE nao vira leitura. Um simbolo que nunca foi lido com
 * sucesso nao tem cotacao "parada": nunca houve cotacao. Isso e um problema
 * de suporte ao papel (ticker errado, fonte que nao cobre), nao um alerta
 * de atraso — e e tambem o que impede a enxurrada de falsos positivos no
 * primeiro deploy, quando a colecao esta vazia.
 *
 * Carimbo no FUTURO tambem nao vira leitura: relogio torto de uma fonte nao
 * pode virar "-40 minutos de atraso".
 */
export function readStaleness(
	record: QuoteFreshnessRecord | null | undefined,
	now: Date
): QuoteStalenessReading | null {
	if (!record) return null;

	const lastQuoteAt = new Date(record.lastQuoteAt);
	const lastQuoteMs = lastQuoteAt.getTime();
	if (!Number.isFinite(lastQuoteMs)) return null;

	const diffMs = now.getTime() - lastQuoteMs;
	if (diffMs < 0) return null;

	return {
		symbol: normalizeSymbol(record.symbol),
		lastQuoteAt,
		minutesSinceLastQuote: Math.floor(diffMs / 60_000),
	};
}
