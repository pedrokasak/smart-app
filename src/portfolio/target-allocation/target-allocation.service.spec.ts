import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TargetAllocationService } from './target-allocation.service';

const mockTargetAllocationModel = {
	findOne: jest.fn(),
	findOneAndUpdate: jest.fn(),
};

describe('TargetAllocationService', () => {
	let service: TargetAllocationService;
	const userId = new Types.ObjectId().toString();

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TargetAllocationService,
				{
					provide: getModelToken('PortfolioTargetAllocation'),
					useValue: mockTargetAllocationModel,
				},
			],
		}).compile();

		service = module.get<TargetAllocationService>(TargetAllocationService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('findByUser', () => {
		it('returns null when the user never configured a target', async () => {
			mockTargetAllocationModel.findOne.mockReturnValue({
				lean: jest.fn().mockResolvedValue(null),
			});

			const result = await service.findByUser(userId);

			expect(result).toBeNull();
			expect(mockTargetAllocationModel.findOne).toHaveBeenCalledWith({
				user: userId,
			});
		});

		it('rejects an invalid user id', async () => {
			await expect(service.findByUser('not-an-id')).rejects.toThrow(
				BadRequestException
			);
		});
	});

	describe('upsertForUser', () => {
		it('upserts the document for the user', async () => {
			const saved = { stocks: 50, crypto: 20, fiis: 20, other: 10 };
			mockTargetAllocationModel.findOneAndUpdate.mockReturnValue({
				lean: jest.fn().mockResolvedValue(saved),
			});

			const result = await service.upsertForUser(userId, {
				stocks: 50,
				crypto: 20,
				fiis: 20,
				other: 10,
			});

			expect(result).toEqual(saved);
			expect(mockTargetAllocationModel.findOneAndUpdate).toHaveBeenCalledWith(
				{ user: userId },
				{
					$set: { stocks: 50, crypto: 20, fiis: 20, other: 10 },
				},
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			);
		});

		it('rejects percentages that sum above 100%', async () => {
			await expect(
				service.upsertForUser(userId, {
					stocks: 60,
					crypto: 60,
				})
			).rejects.toThrow(BadRequestException);
			expect(mockTargetAllocationModel.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('rejects an invalid user id', async () => {
			await expect(
				service.upsertForUser('not-an-id', { stocks: 10 })
			).rejects.toThrow(BadRequestException);
		});
	});
});
