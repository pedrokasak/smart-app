import { Test, TestingModule } from '@nestjs/testing';
import { TokenBlacklistService } from './token-blacklist.service';
import { getModelToken } from '@nestjs/mongoose';

describe('TokenBlacklistService', () => {
	let service: TokenBlacklistService;

	const mockTokenBlacklistModel = {
		create: jest.fn(),
		findOne: jest.fn(),
		deleteMany: jest.fn(),
		exec: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TokenBlacklistService,
				{
					provide: getModelToken('TokenBlacklist'), // ⚡ isso é crucial
					useValue: mockTokenBlacklistModel,
				},
			],
		}).compile();

		service = module.get<TokenBlacklistService>(TokenBlacklistService);
	});

	afterEach(() => jest.clearAllMocks());

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	it('should add token to blacklist', async () => {
		mockTokenBlacklistModel.create.mockResolvedValue(true);
		await service.addToBlacklist('token123', 123456);
		expect(mockTokenBlacklistModel.create).toHaveBeenCalledWith({
			token: 'token123',
			expiresAt: new Date(123456 * 1000),
		});
	});

	it('should check if token is blacklisted', async () => {
		mockTokenBlacklistModel.findOne.mockReturnValue({
			exec: jest.fn().mockResolvedValue(true),
		});
		const result = await service.isBlacklisted('token123');
		expect(result).toBe(true);
	});

	it('should cleanup expired tokens', async () => {
		mockTokenBlacklistModel.deleteMany.mockReturnValue({
			exec: jest.fn().mockResolvedValue(true),
		});
		await service.cleanupExpiredTokens();
		expect(mockTokenBlacklistModel.deleteMany).toHaveBeenCalled();
	});
});
