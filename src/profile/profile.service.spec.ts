jest.mock('src/profile/entity/cpf', () => {
	return {
		default: jest.fn().mockImplementation(() => ({
			value: '12623958793', // qualquer valor válido que você quiser
		})),
	};
});
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileService } from './profile.service';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

const mockProfileModel = {
	create: jest.fn(),
	find: jest.fn().mockReturnThis(),
	findOne: jest.fn().mockReturnThis(),
	findById: jest.fn(),
	findByIdAndDelete: jest.fn(),
	findOneAndUpdate: jest.fn().mockReturnThis(),
	findByIdAndUpdate: jest.fn().mockReturnValue({
		populate: jest.fn().mockReturnThis(),
		exec: jest.fn(),
	}),
	deleteMany: jest.fn(),
	exec: jest.fn(),
};

const mockPermissionModel = {
	find: jest.fn().mockReturnValue({ exec: jest.fn() }),
};

describe('ProfileService', () => {
	let service: ProfileService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProfileService,
				{ provide: getModelToken('Profile'), useValue: mockProfileModel },
				{ provide: getModelToken('User'), useValue: {} },
				{ provide: getModelToken('Permission'), useValue: mockPermissionModel },
			],
		}).compile();

		service = module.get<ProfileService>(ProfileService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('findAll', () => {
		it('should return all profiles', async () => {
			const profiles = [{ cpf: '12623958793' }];
			mockProfileModel.find.mockReturnValue({
				exec: jest.fn().mockResolvedValue(profiles),
			});

			const result = await service.findAll();
			expect(result).toEqual(profiles);
			expect(mockProfileModel.find).toHaveBeenCalled();
		});
	});

	describe('findOne', () => {
		it('should return a profile by userId', async () => {
			const profile = { cpf: '12345678901' };
			const validUserId = new Types.ObjectId().toString();

			mockProfileModel.findOne.mockReturnValue({
				populate: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(profile),
			});

			const result = await service.findOne(validUserId);
			expect(result).toEqual(profile);
			expect(mockProfileModel.findOne).toHaveBeenCalledWith({
				user: validUserId,
			});
		});

		it('should throw NotFoundException if profile not found', async () => {
			mockProfileModel.findOne.mockReturnValue({
				exec: jest.fn().mockResolvedValue(null),
			});

			await expect(service.findOne('userId')).rejects.toThrow(
				NotFoundException
			);
		});
	});

	describe('update', () => {
		it('should update a profile', async () => {
			const validProfileId = new Types.ObjectId().toString();

			const updateDto = {
				phone: '123456789',
				userId: new Types.ObjectId().toString(),
				cpf: '12345678901',
			};

			const updatedProfile = {
				_id: validProfileId,
				...updateDto,
			};

			mockProfileModel.findById.mockResolvedValue({ _id: validProfileId });

			mockProfileModel.findByIdAndUpdate.mockReturnValue({
				populate: jest.fn().mockReturnThis(),
				exec: jest.fn().mockResolvedValue(updatedProfile),
			});

			const result = await service.update(validProfileId, updateDto);

			expect(result).toEqual(updatedProfile);
			expect(mockProfileModel.findById).toHaveBeenCalledWith(validProfileId);
			expect(mockProfileModel.findByIdAndUpdate).toHaveBeenCalledWith(
				validProfileId,
				expect.any(Object),
				{ new: true }
			);
		});

		it('should throw NotFoundException if profile does not exist', async () => {
			const validProfileId = new Types.ObjectId().toString();

			mockProfileModel.findById.mockResolvedValue(null);

			await expect(
				service.update(validProfileId, { phone: '123' })
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('remove', () => {
		it('should remove a profile', async () => {
			mockProfileModel.findByIdAndDelete.mockResolvedValue({ _id: '1' });
			const result = await service.remove('1');
			expect(result).toEqual({
				message: 'Profile deleted successfully',
				id: '1',
			});
			expect(mockProfileModel.findByIdAndDelete).toHaveBeenCalledWith('1');
		});

		it('should throw NotFoundException if profile does not exist', async () => {
			mockProfileModel.findByIdAndDelete.mockResolvedValue(null);
			await expect(service.remove('1')).rejects.toThrow(NotFoundException);
		});
	});

	describe('removeAll', () => {
		it('should delete all profiles', async () => {
			mockProfileModel.deleteMany.mockResolvedValue({ deletedCount: 5 });
			await service.removeAll();
			expect(mockProfileModel.deleteMany).toHaveBeenCalled();
		});
	});
});
