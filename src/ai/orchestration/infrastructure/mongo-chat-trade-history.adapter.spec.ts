import { Types } from 'mongoose';
import { MongoChatTradeHistoryAdapter } from 'src/ai/orchestration/infrastructure/mongo-chat-trade-history.adapter';
import { MAX_TRADES_READ } from 'src/ai/orchestration/trade-history/chat-trade-history.port';

describe('MongoChatTradeHistoryAdapter (ADR-002, TRA-16, fase 2)', () => {
	const userId = new Types.ObjectId().toHexString();
	let lean: jest.Mock;
	let limit: jest.Mock;
	let find: jest.Mock;
	let adapter: MongoChatTradeHistoryAdapter;

	beforeEach(() => {
		lean = jest.fn().mockResolvedValue([]);
		limit = jest.fn().mockReturnValue({ lean });
		const chain = {
			select: jest.fn().mockReturnThis(),
			sort: jest.fn().mockReturnThis(),
			limit,
		};
		find = jest.fn().mockReturnValue(chain);
		adapter = new MongoChatTradeHistoryAdapter({ find } as never);
	});

	it('always scopes the query to the owner', async () => {
		await adapter.listTrades(userId, {});

		expect(find).toHaveBeenCalledWith({ userId: new Types.ObjectId(userId) });
		expect(limit).toHaveBeenCalledWith(MAX_TRADES_READ);
	});

	it('applies symbol, side and an inclusive date range', async () => {
		await adapter.listTrades(userId, {
			symbol: 'itsa4',
			side: 'buy',
			from: '2025-01-01',
			to: '2025-12-31',
		});

		expect(find).toHaveBeenCalledWith({
			userId: new Types.ObjectId(userId),
			symbol: 'ITSA4',
			side: 'buy',
			date: {
				$gte: new Date('2025-01-01T00:00:00.000Z'),
				$lte: new Date('2025-12-31T23:59:59.999Z'),
			},
		});
	});

	it('maps documents to rows', async () => {
		const date = new Date('2026-03-10T00:00:00.000Z');
		lean.mockResolvedValue([
			{ symbol: 'ITSA4', side: 'sell', quantity: 5, price: 11, date },
		]);

		expect(await adapter.listTrades(userId, {})).toEqual([
			{ symbol: 'ITSA4', side: 'sell', quantity: 5, price: 11, fees: 0, date },
		]);
	});

	it('returns nothing for an invalid user id without querying', async () => {
		expect(await adapter.listTrades('nao-e-id', {})).toEqual([]);
		expect(find).not.toHaveBeenCalled();
	});
});
