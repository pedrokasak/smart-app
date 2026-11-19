import { Types } from 'mongoose';
import { MongoRagTradeSourceAdapter } from 'src/ai/rag-ingestion/infrastructure/mongo-rag-trade-source.adapter';

describe('MongoRagTradeSourceAdapter (ADR-002, TRA-16)', () => {
	const userId = new Types.ObjectId().toHexString();
	let lean: jest.Mock;
	let find: jest.Mock;
	let adapter: MongoRagTradeSourceAdapter;

	beforeEach(() => {
		lean = jest.fn().mockResolvedValue([]);
		const chain = {
			select: jest.fn().mockReturnThis(),
			sort: jest.fn().mockReturnThis(),
			lean,
		};
		find = jest.fn().mockReturnValue(chain);
		adapter = new MongoRagTradeSourceAdapter({ find } as never);
	});

	it('reads only the owner trades and maps them to the domain shape', async () => {
		const date = new Date('2026-03-10T00:00:00.000Z');
		lean.mockResolvedValue([
			{ symbol: 'ITSA4', side: 'buy', quantity: 100, price: 10, fees: 2, date },
			{ symbol: 'VALE3', side: 'sell', quantity: 5, price: 60, date },
		]);

		const trades = await adapter.listTrades(userId);

		expect(find).toHaveBeenCalledWith({ userId: new Types.ObjectId(userId) });
		expect(trades).toEqual([
			{
				assetSymbol: 'ITSA4',
				side: 'buy',
				quantity: 100,
				price: 10,
				fees: 2,
				date,
			},
			{
				assetSymbol: 'VALE3',
				side: 'sell',
				quantity: 5,
				price: 60,
				fees: 0,
				date,
			},
		]);
	});

	it('returns nothing for an invalid user id without querying', async () => {
		expect(await adapter.listTrades('not-an-id')).toEqual([]);
		expect(find).not.toHaveBeenCalled();
	});
});
