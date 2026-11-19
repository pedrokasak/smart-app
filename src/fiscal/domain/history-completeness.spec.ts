import { findIncompleteHistory } from './history-completeness';

const buy = (symbol: string, quantity: number, date: string) => ({
	symbol,
	side: 'buy',
	quantity,
	date,
});
const sell = (symbol: string, quantity: number, date: string) => ({
	symbol,
	side: 'sell',
	quantity,
	date,
});

describe('findIncompleteHistory', () => {
	it('não aponta nada quando as vendas cabem na posição', () => {
		expect(
			findIncompleteHistory([
				buy('PETR4', 100, '2026-01-10'),
				sell('PETR4', 40, '2026-02-10'),
				sell('PETR4', 60, '2026-03-10'),
			])
		).toEqual([]);
	});

	it('aponta venda maior que a posição conhecida', () => {
		expect(
			findIncompleteHistory([
				buy('BOVA11', 10, '2026-01-10'),
				sell('BOVA11', 25, '2026-02-10'),
			])
		).toEqual([
			{
				symbol: 'BOVA11',
				missingQuantity: 15,
				firstShortfallDate: '2026-02-10',
			},
		]);
	});

	it('aponta venda de ativo sem nenhuma compra', () => {
		const result = findIncompleteHistory([sell('MXRF11', 50, '2026-05-02')]);

		expect(result).toEqual([
			{
				symbol: 'MXRF11',
				missingQuantity: 50,
				firstShortfallDate: '2026-05-02',
			},
		]);
	});

	it('soma as faltas de várias vendas e guarda a primeira data', () => {
		const [item] = findIncompleteHistory([
			sell('VALE3', 10, '2026-01-05'),
			buy('VALE3', 5, '2026-02-05'),
			sell('VALE3', 8, '2026-03-05'),
		]);

		expect(item.missingQuantity).toBe(13);
		expect(item.firstShortfallDate).toBe('2026-01-05');
	});

	it('no mesmo dia a compra vale antes da venda (day trade)', () => {
		expect(
			findIncompleteHistory([
				sell('WEGE3', 100, '2026-04-10T15:00:00Z'),
				buy('WEGE3', 100, '2026-04-10T13:00:00Z'),
			])
		).toEqual([]);
	});

	it('ignora ruído de ponto flutuante em cripto', () => {
		expect(
			findIncompleteHistory([
				buy('BTC', 0.3, '2026-01-01'),
				sell('BTC', 0.1 + 0.2, '2026-01-03'),
			])
		).toEqual([]);
	});

	it('ignora lançamentos inválidos e ordena por símbolo', () => {
		const result = findIncompleteHistory([
			sell('ZZZZ3', 1, '2026-01-01'),
			sell('AAAA3', 1, '2026-01-01'),
			{ symbol: '', side: 'sell', quantity: 5, date: '2026-01-01' },
			{ symbol: 'XXXX3', side: 'sell', quantity: 0, date: '2026-01-01' },
			{ symbol: 'YYYY3', side: 'sell', quantity: 3, date: 'lixo' },
		]);

		expect(result.map((item) => item.symbol)).toEqual(['AAAA3', 'ZZZZ3']);
	});

	it('trata símbolo sem diferenciar maiúsculas', () => {
		expect(
			findIncompleteHistory([
				buy('petr4', 10, '2026-01-01'),
				sell('PETR4', 10, '2026-01-02'),
			])
		).toEqual([]);
	});
});
