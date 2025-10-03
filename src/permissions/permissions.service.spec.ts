import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsService } from './permissions.service';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';

describe('PermissionsService', () => {
	let service: PermissionsService;
	let model: any;

	const mockPermissionModel = {
		find: jest.fn(),
		create: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				PermissionsService,
				{
					provide: getModelToken('Permission'),
					useValue: mockPermissionModel,
				},
			],
		}).compile();

		service = module.get<PermissionsService>(PermissionsService);
		model = module.get(getModelToken('Permission'));
		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('create', () => {
		it('should throw NotFoundException if profile not found', async () => {
			model.find.mockResolvedValue(null);
			await expect(
				service.create({ name: 'test', profileId: '123' })
			).rejects.toThrow(NotFoundException);
		});

		it('should create and return permission if profile exists', async () => {
			model.find.mockResolvedValue([{ id: '123' }]);
			model.create.mockResolvedValue({
				name: 'test',
				profile: { connect: { id: '123' } },
			});
			const result = await service.create({ name: 'test', profileId: '123' });
			expect(model.create).toHaveBeenCalledWith({
				name: 'test',
				profile: { connect: { id: '123' } },
			});
			expect(result).toEqual({
				name: 'test',
				profile: { connect: { id: '123' } },
			});
		});
	});

	describe('findAll', () => {
		it('should return all permissions', async () => {
			model.find.mockResolvedValue([{ name: 'perm1' }]);
			const result = await service.findAll();
			expect(result).toEqual([{ name: 'perm1' }]);
		});
	});
});
