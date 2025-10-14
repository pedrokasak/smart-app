import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('PermissionsController', () => {
	let controller: PermissionsController;
	let service: PermissionsService;

	const mockPermissionsService = {
		create: jest.fn(),
		findAll: jest.fn(),
		findOne: jest.fn(),
		update: jest.fn(),
		remove: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PermissionsController],
			providers: [
				{ provide: PermissionsService, useValue: mockPermissionsService },
			],
		}).compile();

		controller = module.get<PermissionsController>(PermissionsController);
		service = module.get<PermissionsService>(PermissionsService);

		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	// --- CREATE ---
	describe('create', () => {
		it('should call service.create with DTO and return result', async () => {
			const dto = {
				permission: 'VIEW_DASHBOARD',
				profileId: '1',
				name: 'VIEW_DASHBOARD',
			};
			const expected = { permission: 'VIEW_DASHBOARD' };
			mockPermissionsService.create.mockResolvedValue(expected);

			const result = await controller.create(dto);

			expect(service.create).toHaveBeenCalledWith(dto);
			expect(result).toEqual(expected);
		});
	});

	// --- FIND ALL ---
	describe('findAll', () => {
		it('should return list of permissions', async () => {
			const mockList = [
				{ id: 1, permission: 'READ_USER' },
				{ id: 2, permission: 'WRITE_USER' },
			];
			mockPermissionsService.findAll.mockResolvedValue(mockList);

			const result = await controller.findAll();

			expect(service.findAll).toHaveBeenCalled();
			expect(result).toEqual(mockList);
		});
	});

	// --- FIND ONE ---
	describe('findOne', () => {
		it('should return one permission by id', async () => {
			const mockPermission = { id: 1, permission: 'READ_USER' };
			mockPermissionsService.findOne.mockResolvedValue(mockPermission);

			const result = await controller.findOne('1');

			expect(service.findOne).toHaveBeenCalledWith(1);
			expect(result).toEqual(mockPermission);
		});
	});

	// --- UPDATE ---
	describe('update', () => {
		it('should call service.update with id and DTO', async () => {
			const dto = {
				permission: 'EDIT_USER',
				profileId: '1',
				name: 'EDIT_USER',
			};
			const updated = { id: 1, permission: 'EDIT_USER' };
			mockPermissionsService.update.mockResolvedValue(updated);

			const result = await controller.update('1', dto);

			expect(service.update).toHaveBeenCalledWith(1, dto);
			expect(result).toEqual(updated);
		});
	});

	// --- REMOVE ---
	describe('remove', () => {
		it('should call service.remove with id', async () => {
			mockPermissionsService.remove.mockResolvedValue({ deleted: true });

			const result = await controller.remove('1');

			expect(service.remove).toHaveBeenCalledWith(1);
			expect(result).toEqual({ deleted: true });
		});
	});
});
