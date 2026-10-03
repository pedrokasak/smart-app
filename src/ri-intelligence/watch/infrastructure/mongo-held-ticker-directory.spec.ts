import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { MongoHeldTickerDirectory } from 'src/ri-intelligence/watch/infrastructure/mongo-held-ticker-directory';

describe('MongoHeldTickerDirectory (TRA-240)', () => {
	it('lists distinct held stock tickers, normalized', async () => {
		const assetModel = {
			distinct: jest.fn(() => ({
				exec: jest
					.fn()
					.mockResolvedValue([' petr4 ', 'VALE3', 'PETR4', 'ITUB4.SA', null]),
			})),
		};
		const directory = new MongoHeldTickerDirectory(
			assetModel as unknown as Model<Asset>
		);

		await expect(directory.heldStockTickers()).resolves.toEqual([
			'ITUB4',
			'PETR4',
			'VALE3',
		]);
		expect(assetModel.distinct).toHaveBeenCalledWith('symbol', {
			quantity: { $gt: 0 },
			type: 'stock',
		});
	});

	// TRA-266: FIIs em carteira, pela FundosNet.
	it('lists distinct held FII tickers, normalized', async () => {
		const assetModel = {
			distinct: jest.fn(() => ({
				exec: jest.fn().mockResolvedValue(['hglg11', 'KNRI11.SA', 'HGLG11']),
			})),
		};
		const directory = new MongoHeldTickerDirectory(
			assetModel as unknown as Model<Asset>
		);

		await expect(directory.heldFiiTickers()).resolves.toEqual([
			'HGLG11',
			'KNRI11',
		]);
		expect(assetModel.distinct).toHaveBeenCalledWith('symbol', {
			quantity: { $gt: 0 },
			type: 'fii',
		});
	});
});
