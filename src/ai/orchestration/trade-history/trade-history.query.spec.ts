import { parseTradeHistoryQuery } from 'src/ai/orchestration/trade-history/trade-history.query';

const TODAY = new Date('2026-10-18T12:00:00.000Z');

describe('parseTradeHistoryQuery (ADR-002, TRA-16, fase 2)', () => {
	it('reads the ticker from the router and nothing else from it', () => {
		expect(
			parseTradeHistoryQuery('quando comprei ITSA4?', ['itsa4'], TODAY)
		).toEqual({
			symbol: 'ITSA4',
			side: 'buy',
		});
	});

	it.each([
		[
			'quanto paguei de corretagem em 2025?',
			'2025-01-01',
			'2025-12-31',
			'2025',
		],
		['minhas compras este ano', '2026-01-01', '2026-10-18', '2026'],
		['o que vendi neste ano', '2026-01-01', '2026-10-18', '2026'],
		['operações do ano passado', '2025-01-01', '2025-12-31', '2025'],
		['quanto comprei este mês', '2026-10-01', '2026-10-18', '10/2026'],
		['o que comprei mês passado', '2026-09-01', '2026-09-30', '09/2026'],
		[
			'compras dos últimos 3 meses',
			'2026-07-18',
			'2026-10-18',
			'últimos 3 meses',
		],
	])('period in "%s"', (question, from, to, label) => {
		const query = parseTradeHistoryQuery(question, [], TODAY);
		expect(query.from).toBe(from);
		expect(query.to).toBe(to);
		expect(query.periodLabel).toBe(label);
	});

	it('crosses the year boundary when asking for last month in January', () => {
		const query = parseTradeHistoryQuery(
			'o que comprei mês passado',
			[],
			new Date('2026-01-10T12:00:00.000Z')
		);
		expect(query.from).toBe('2025-12-01');
		expect(query.to).toBe('2025-12-31');
	});

	it('ignores a future year and gives no period when none is asked', () => {
		expect(
			parseTradeHistoryQuery('compras em 2031', [], TODAY).from
		).toBeUndefined();
		expect(parseTradeHistoryQuery('minhas operações', [], TODAY)).toEqual({});
	});

	it('detects the side, and leaves it open when the question asks for both', () => {
		expect(parseTradeHistoryQuery('quantas compras fiz', [], TODAY).side).toBe(
			'buy'
		);
		expect(parseTradeHistoryQuery('o que vendi', [], TODAY).side).toBe('sell');
		expect(
			parseTradeHistoryQuery('minhas compras e vendas de 2025', [], TODAY).side
		).toBeUndefined();
	});

	it('never takes dates from anywhere but the question text', () => {
		const query = parseTradeHistoryQuery(
			'quando comprei VALE3?',
			['VALE3'],
			TODAY
		);
		expect(query.from).toBeUndefined();
		expect(query.to).toBeUndefined();
	});
});
