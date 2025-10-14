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

const mockProfileModel = {
	find: jest.fn(),
	findOne: jest.fn(),
	findById: jest.fn(),
	findByIdAndUpdate: jest.fn(),
	findByIdAndDelete: jest.fn(),
	deleteMany: jest.fn(),
	save: jest.fn(),
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
			const profiles = [{ cpf: '12623958793,' }];
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
			mockProfileModel.findOne.mockReturnValue({
				exec: jest.fn().mockResolvedValue(profile),
			});

			const result = await service.findOne('userId');
			expect(result).toEqual({ profile });
			expect(mockProfileModel.findOne).toHaveBeenCalledWith({ user: 'userId' });
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
			const dto = { cpf: '71253281050', userId: 'user123', permissions: [] };

			const profile = { _id: '1' };

			mockProfileModel.findById.mockResolvedValue(profile);
			mockProfileModel.findByIdAndUpdate.mockResolvedValue({
				...profile,
				...dto,
			});

			const result = await service.update('1', dto);
			expect(result).toEqual({ ...profile, ...dto });
			expect(mockProfileModel.findByIdAndUpdate).toHaveBeenCalledWith(
				'1',
				dto,
				{ new: true }
			);
		});

		it('should throw NotFoundException if profile does not exist', async () => {
			mockProfileModel.findById.mockResolvedValue(null);

			await expect(service.update('1', { cpf: '12345678901' })).rejects.toThrow(
				NotFoundException
			);
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
			await service.removeAll();
			expect(mockProfileModel.deleteMany).toHaveBeenCalled();
		});
	});
});
