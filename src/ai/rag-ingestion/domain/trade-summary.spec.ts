import {
	buildTradeSummaryItems,
	TRADE_SUMMARY_MAX_MONTHS,
} from 'src/ai/rag-ingestion/domain/trade-summary';
import type { Trade } from 'src/fiscal/domain/trade';

const trade = (overrides: Partial<Trade>): Trade => ({
	assetSymbol: 'ITSA4',
	side: 'buy',
	quantity: 100,
	price: 10,
	fees: 0,
	date: new Date('2026-03-10T00:00:00.000Z'),
	...overrides,
});

describe('buildTradeSummaryItems (ADR-002, TRA-16)', () => {
	it('summarises one asset-month with weighted average price and costs', () => {
		const items = buildTradeSummaryItems(
			[
				trade({ quantity: 100, price: 10, fees: 2.45 }),
				trade({ quantity: 200, price: 10.7, fees: 2.45 }),
			],
			'2026-10-17'
		);

		expect(items).toEqual([
			{
				sourceType: 'portfolio_trade_summary',
				sourceId: 'trade_summary:ITSA4:2026-03',
				content:
					'ITSA4 em 03/2026: 2 compras (300 unidades, preço médio R$ 10,47), custos R$ 4,90.',
				metadata: { symbol: 'ITSA4', month: '2026-03' },
				asOf: '2026-10-17',
			},
		]);
	});

	it('writes buys and sells of the same month in one chunk', () => {
		const [item] = buildTradeSummaryItems(
			[
				trade({ side: 'buy', quantity: 100, price: 10 }),
				trade({ side: 'sell', quantity: 40, price: 12.5 }),
			],
			'2026-10-17'
		);

		expect(item.content).toBe(
			'ITSA4 em 03/2026: 1 compra (100 unidades, preço médio R$ 10,00) e 1 venda (40 unidades, preço médio R$ 12,50).'
		);
	});

	it('splits by month and by asset, in a stable order', () => {
		const items = buildTradeSummaryItems(
			[
				trade({
					assetSymbol: 'VALE3',
					date: new Date('2026-02-03T00:00:00.000Z'),
				}),
				trade({ date: new Date('2026-04-03T00:00:00.000Z') }),
				trade({ date: new Date('2026-03-03T00:00:00.000Z') }),
			],
			'2026-10-17'
		);

		expect(items.map((i) => i.sourceId)).toEqual([
			'trade_summary:ITSA4:2026-03',
			'trade_summary:ITSA4:2026-04',
			'trade_summary:VALE3:2026-02',
		]);
	});

	it('is deterministic: the same history gives the same text, in any input order', () => {
		const a = trade({ quantity: 100, price: 10 });
		const b = trade({
			quantity: 50,
			price: 11,
			date: new Date('2026-03-20T00:00:00.000Z'),
		});

		const first = buildTradeSummaryItems([a, b], '2026-10-17');
		const second = buildTradeSummaryItems([b, a], '2026-10-18');

		expect(second.map((i) => i.content)).toEqual(first.map((i) => i.content));
	});

	it('keeps only the most recent months of each asset', () => {
		const trades = Array.from(
			{ length: TRADE_SUMMARY_MAX_MONTHS + 5 },
			(_, i) => trade({ date: new Date(Date.UTC(2020, i, 5)) })
		);

		const items = buildTradeSummaryItems(trades, '2026-10-17');

		expect(items).toHaveLength(TRADE_SUMMARY_MAX_MONTHS);
		expect(items.some((i) => i.sourceId.endsWith('2020-01'))).toBe(false);
	});

	it('ignores invalid rows and returns nothing without trades', () => {
		expect(buildTradeSummaryItems([], '2026-10-17')).toEqual([]);
		expect(
			buildTradeSummaryItems(
				[
					trade({ quantity: 0 }),
					trade({ assetSymbol: '' }),
					trade({ date: new Date('invalid') }),
				],
				'2026-10-17'
			)
		).toEqual([]);
	});
});
