/**
 * PDFs exportados pela Área do Investidor da B3.
 *
 * Só o Extrato de Negociação vira operações: cada negócio ocupa uma linha
 * inteira ("Compra Mercado à Vista BANCO X ITUB4F 10 R$ 30,00 R$ 300,00").
 * Movimentação e Consolidado quebram produto e instituição em várias linhas
 * no PDF, então ler esses dois por texto daria números errados — para eles a
 * importação pede o Excel, que traz as mesmas informações em colunas.
 */
export type B3PdfKind =
	| 'negotiation'
	| 'movement'
	| 'position'
	| 'events'
	| 'unknown';

export interface ParsedPdfTrade {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees: number;
	date: Date;
}

export function classifyB3PdfText(text: string): B3PdfKind {
	const normalized = text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
	if (
		!normalized.includes('investidor.b3.com.br') &&
		!normalized.includes('filtros aplicados')
	) {
		return 'unknown';
	}
	if (normalized.includes('extrato de negociacao')) return 'negotiation';
	if (normalized.includes('extrato de movimentacao')) return 'movement';
	if (normalized.includes('posicao - ')) return 'position';
	if (normalized.includes('proventos a receber')) return 'events';
	return 'unknown';
}

const MONTHS: Record<string, number> = {
	janeiro: 0,
	fevereiro: 1,
	marco: 2,
	abril: 3,
	maio: 4,
	junho: 5,
	julho: 6,
	agosto: 7,
	setembro: 8,
	outubro: 9,
	novembro: 10,
	dezembro: 11,
};

const DATE_LINE = /^(\d{1,2}) de ([a-zç]+) de (\d{4})$/i;
// Compra|Venda … TICKER[F] quantidade R$ preço R$ valor
const TRADE_LINE =
	/^(Compra|Venda)\b.*?\s([A-Z]{4}\d{1,2}B?)F?\s+([\d.]+)\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s*$/;

const toNumber = (value: string) =>
	Number(value.replace(/\./g, '').replace(',', '.'));

export function parseB3NegotiationPdfText(text: string): ParsedPdfTrade[] {
	const trades: ParsedPdfTrade[] = [];
	let currentDate: Date | null = null;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
		const dateMatch = line
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.match(DATE_LINE);
		if (dateMatch) {
			const month = MONTHS[dateMatch[2].toLowerCase()];
			if (month !== undefined) {
				currentDate = new Date(
					Date.UTC(Number(dateMatch[3]), month, Number(dateMatch[1]))
				);
			}
			continue;
		}

		const trade = line.match(TRADE_LINE);
		if (!trade || !currentDate) continue;
		const quantity = toNumber(trade[3]);
		const price = toNumber(trade[4]);
		if (!(quantity > 0) || !(price > 0)) continue;

		trades.push({
			symbol: trade[2].toUpperCase(),
			side: trade[1] === 'Compra' ? 'buy' : 'sell',
			quantity,
			price,
			fees: 0,
			date: currentDate,
		});
	}
	return trades;
}
