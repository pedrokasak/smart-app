import { Test, TestingModule } from '@nestjs/testing';
import { BrokerSyncService } from './broker-sync.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { BrokerConnectionModel } from './schema/broker-connection.model';
import { Types } from 'mongoose';
import * as crypto from 'crypto';

jest.mock('ccxt', () => {
	return {
		binance: jest.fn().mockImplementation(() => {
			return {
				fetchBalance: jest.fn().mockResolvedValue({
					total: {
						BTC: 1.5,
						ETH: 10,
						USDT: 0,
					},
				}),
			};
		}),
		coinbase: jest.fn(),
	};
});

describe('BrokerSyncService', () => {
	let service: BrokerSyncService;
	let portfolioService: PortfolioService;
	let assetsService: AssetsService;

	const mockPortfolioService = {
		findPortfolioByName: jest.fn(),
		createPortfolio: jest.fn(),
		addAssetToPortfolio: jest.fn(),
	};

	const mockAssetsService = {
		findAssetBySymbolAndPortfolio: jest.fn(),
		update: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				BrokerSyncService,
				{
					provide: PortfolioService,
					useValue: mockPortfolioService,
				},
				{
					provide: AssetsService,
					useValue: mockAssetsService,
				},
			],
		}).compile();

		service = module.get<BrokerSyncService>(BrokerSyncService);
		portfolioService = module.get<PortfolioService>(PortfolioService);
		assetsService = module.get<AssetsService>(AssetsService);

		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	it('should sync binance successfully', async () => {
		const userId = new Types.ObjectId().toString();
		const provider = 'binance';

		const mockConnection = {
			userId: new Types.ObjectId(userId),
			provider,
			apiKeyEncrypted: 'iv:encryptedKey',
			apiSecretEncrypted: 'iv:encryptedSecret',
			status: 'connected',
			save: jest.fn().mockResolvedValue(true),
		};

		// Mock cryptografia
		jest.spyOn(service as any, 'decrypt').mockReturnValue('decryptedValue');

		jest
			.spyOn(BrokerConnectionModel, 'findOne')
			.mockResolvedValue(mockConnection as any);

		const mockPortfolio = {
			_id: new Types.ObjectId(),
			name: provider,
		};
		mockPortfolioService.findPortfolioByName.mockResolvedValue(mockPortfolio);

		mockAssetsService.findAssetBySymbolAndPortfolio
			.mockResolvedValueOnce({
				_id: new Types.ObjectId(),
				symbol: 'BTC',
				price: 50000,
			})
			.mockResolvedValueOnce(null); // ETH será novo

		const result = await service.syncConnection(userId, provider);

		expect(result.syncedAssets).toBe(2);
		expect(result.message).toBe('Sincronização com binance concluída.');
		expect(mockPortfolioService.addAssetToPortfolio).toHaveBeenCalledTimes(1);
		expect(mockAssetsService.update).toHaveBeenCalledTimes(1);
		expect(mockConnection.save).toHaveBeenCalled();
	});
});
