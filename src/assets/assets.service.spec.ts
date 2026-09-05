import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { DividendReceivedProducer } from './events/dividend-received.producer';

describe('AssetsService', () => {
	let service: AssetsService;

	// Mock do AssetModel
	const mockAssetModel = {
		find: jest.fn(),
		findById: jest.fn(),
		findOne: jest.fn(),
		create: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		findByIdAndDelete: jest.fn(),
	};

	// Mock do PortfolioService
	const mockPortfolioService = {
		findOne: jest.fn(),
		// adicione outros métodos que o AssetsService usa
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AssetsService,
				{
					provide: 'AssetModel', // ou o nome correto do token
					useValue: mockAssetModel,
				},
				{
					provide: PortfolioService,
					useValue: mockPortfolioService,
				},
				// TRA-136: produtor do evento de provento.
				{
					provide: DividendReceivedProducer,
					useValue: { publishForAsset: jest.fn() },
				},
			],
		}).compile();

		service = module.get<AssetsService>(AssetsService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
