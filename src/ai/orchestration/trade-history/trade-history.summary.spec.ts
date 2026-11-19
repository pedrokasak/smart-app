import {
	MAX_TRADE_ITEMS,
	summarizeTrades,
	type TradeRow,
} from 'src/ai/orchestration/trade-history/trade-history.summary';

const trade = (overrides: Partial<TradeRow> = {}): TradeRow => ({
	symbol: 'ITSA4',
	side: 'buy',
	quantity: 100,
	price: 10,
	fees: 1.5,
	date: new Date('2026-03-10T00:00:00.000Z'),
	...overrides,
});

describe('summarizeTrades (ADR-002, TRA-16, fase 2)', () => {
	it('sums buys, sells and costs exactly', () => {
		const summary = summarizeTrades([
			trade({ quantity: 100, price: 10, fees: 2.45 }),
			trade({ quantity: 200, price: 10.7, fees: 2.45 }),
			trade({ side: 'sell', quantity: 40, price: 12.5, fees: 1 }),
		]);

		expect(summary.count).toBe(3);
		expect(summary.buys).toEqual({ count: 2, quantity: 300, total: 3140 });
		expect(summary.sells).toEqual({ count: 1, quantity: 40, total: 500 });
		expect(summary.fees).toBe(5.9);
	});

	it('lists the most recent first and reports the date range', () => {
		const summary = summarizeTrades([
			trade({ date: new Date('2026-01-05T00:00:00.000Z') }),
			trade({ date: new Date('2026-06-20T00:00:00.000Z') }),
			trade({ date: new Date('2026-03-10T00:00:00.000Z') }),
		]);

		expect(summary.items.map((i) => i.date)).toEqual([
			'2026-06-20',
			'2026-03-10',
			'2026-01-05',
		]);
		expect(summary.firstDate).toBe('2026-01-05');
		expect(summary.lastDate).toBe('2026-06-20');
		expect(summary.truncated).toBe(false);
	});

	it('truncates the list but not the totals', () => {
		const trades = Array.from({ length: MAX_TRADE_ITEMS + 5 }, (_, i) =>
			trade({ date: new Date(Date.UTC(2026, 0, i + 1)) })
		);

		const summary = summarizeTrades(trades);

		expect(summary.items).toHaveLength(MAX_TRADE_ITEMS);
		expect(summary.truncated).toBe(true);
		expect(summary.count).toBe(MAX_TRADE_ITEMS + 5);
		expect(summary.buys.count).toBe(MAX_TRADE_ITEMS + 5);
	});

	it('returns an empty summary for no trades and skips invalid rows', () => {
		const empty = summarizeTrades([]);
		expect(empty.count).toBe(0);
		expect(empty.firstDate).toBeNull();
		expect(empty.items).toEqual([]);

		expect(
			summarizeTrades([
				trade({ quantity: 0 }),
				trade({ date: new Date('invalid') }),
				trade({ price: Number.NaN }),
			]).count
		).toBe(0);
	});

	it('carries only trade facts: no identifiers', () => {
		const [item] = summarizeTrades([trade()]).items;
		expect(Object.keys(item).sort()).toEqual([
			'date',
			'price',
			'quantity',
			'side',
			'symbol',
		]);
	});
});
