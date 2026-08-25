import * as fs from 'fs';
import * as xlsx from 'xlsx';
import { buildHistoryFromTrades } from './history-from-trades';

/**
 * Prova com o extrato de negociação real: a série derivada das
 * negociações tem movimento de verdade, então os botões de período
 * deixam de mostrar todos a mesma coisa.
 *
 * O arquivo fica fora do repositório; sem ele os casos são pulados, para
 * o CI não depender do Downloads de ninguém.
 */
const REAL_NEGOTIATION_FILE =
	'C:/Users/Pedro Henrique/Downloads/negociacao-2026-08-25-11-30-21.xlsx';

const hasRealFile = fs.existsSync(REAL_NEGOTIATION_FILE);
const describeWithRealFile = hasRealFile ? describe : describe.skip;

const parseBrDate = (value: string): string => {
	const [day, month, year] = String(value).split('/');
	return `${year}-${month}-${day}`;
};

const loadRealTrades = () => {
	const workbook = xlsx.readFile(REAL_NEGOTIATION_FILE);
	const rows = xlsx.utils.sheet_to_json(workbook.Sheets['Negociação'], {
		defval: null,
		raw: false,
	}) as any[];

	return rows
		.map((row) => ({
			symbol: String(row['Código de Negociação'] || '').trim(),
			side:
				String(row['Tipo de Movimentação'] || '')
					.trim()
					.toLowerCase() === 'compra'
					? ('buy' as const)
					: ('sell' as const),
			quantity: Number(row['Quantidade']),
			price: Number(row['Preço']),
			date: parseBrDate(row['Data do Negócio']),
		}))
		.filter(
			(trade) =>
				trade.symbol &&
				Number.isFinite(trade.quantity) &&
				Number.isFinite(trade.price)
		);
};

describeWithRealFile('histórico derivado do extrato de negociação real', () => {
	it('produz uma série com movimento real, não uma linha reta', () => {
		const trades = loadRealTrades();
		expect(trades.length).toBeGreaterThan(0);

		const points = buildHistoryFromTrades(trades, new Date('2026-08-25'));

		const valores = points.map((point) => point.totalValue);
		const distintos = new Set(valores);

		// O bug relatado era exatamente isto: um único valor repetido.
		expect(distintos.size).toBeGreaterThan(1);
		expect(Math.max(...valores)).toBeGreaterThan(Math.min(...valores));
	});

	it('cobre mais de um ano, então 1A mostra algo diferente de 1M', () => {
		const trades = loadRealTrades();
		const points = buildHistoryFromTrades(trades, new Date('2026-08-25'));

		const ultimos30 = points.slice(-30).map((point) => point.totalValue);
		const ultimos365 = points.slice(-365).map((point) => point.totalValue);

		expect(points.length).toBeGreaterThan(365);

		const amplitude = (valores: number[]) =>
			Math.max(...valores) - Math.min(...valores);

		// A janela de um ano abrange mais variação que a de um mês — que é o
		// que faz os botões de período valerem alguma coisa.
		expect(amplitude(ultimos365)).toBeGreaterThan(amplitude(ultimos30));
	});

	it('o valor investido cresce com os aportes', () => {
		const trades = loadRealTrades();
		const points = buildHistoryFromTrades(trades, new Date('2026-08-25'));

		const primeiro = points[0].investedValue;
		const ultimo = points[points.length - 1].investedValue;

		expect(ultimo).toBeGreaterThan(primeiro);
	});
});
