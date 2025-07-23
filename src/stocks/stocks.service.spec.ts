import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stocks.service';

describe('TwelveDataService', () => {
	let service: StockService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [StockService],
		}).compile();

		service = module.get<StockService>(StockService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
