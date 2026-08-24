import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

const mockProfileService = {
	findAll: jest.fn().mockResolvedValue([{ user: '123', cpf: '00000000000' }]),
	create: jest.fn(),
	findOne: jest.fn(),
	update: jest.fn(),
	remove: jest.fn(),
	assertProfileOwnership: jest.fn().mockResolvedValue(undefined),
};

/** Rotas por id agora exigem o dono; admin é a exceção. */
const reqFor = (userId: string, role = 'user') =>
	({ user: { userId, role } }) as any;

describe('ProfileController', () => {
	let controller: ProfileController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ProfileController],
			providers: [{ provide: ProfileService, useValue: mockProfileService }],
		}).compile();

		controller = module.get<ProfileController>(ProfileController);
	});

	afterEach(() => jest.clearAllMocks());

	it('should create a profile', async () => {
		const dto = { cpf: '123', userId: 'user1', permissions: [] };
		const fakeResponse = { message: 'ok' };
		mockProfileService.create.mockResolvedValue(fakeResponse);
		const result = await controller.create(dto.userId, dto, reqFor('user1'));
		expect(result).toEqual(fakeResponse);
		expect(mockProfileService.create).toHaveBeenCalledWith(dto.userId, dto);
	});

	it('should get all profiles', async () => {
		const fakeProfiles = [{ cpf: '123' }];
		mockProfileService.findAll.mockResolvedValue(fakeProfiles);
		const result = await controller.findAll();
		expect(result).toEqual(fakeProfiles);
	});

	it('should get one profile', async () => {
		const fakeProfile = {
			_id: { toString: () => 'profile-id' },
			user: { toString: () => 'user-id' },
			phone: '99999999',
			birthDate: new Date(),
		};

		mockProfileService.findOne.mockResolvedValue(fakeProfile);

		const result = await controller.findOne('user-id', reqFor('user-id'));

		expect(mockProfileService.findOne).toHaveBeenCalledWith('user-id');
		expect(result).toEqual(
			expect.objectContaining({
				id: 'profile-id',
				userId: 'user-id',
			})
		);
	});

	it('should update a profile', async () => {
		const dto = { cpf: '999', userId: 'user1' };
		const fakeProfile = { cpf: '999' };
		mockProfileService.update.mockResolvedValue(fakeProfile);
		const result = await controller.update('1', dto, reqFor('user1'));
		expect(result).toEqual(fakeProfile);
		expect(mockProfileService.update).toHaveBeenCalledWith('1', dto);
	});

	it('should remove a profile', async () => {
		const fakeResponse = { message: 'Profile deleted successfully', id: '1' };
		mockProfileService.remove.mockResolvedValue(fakeResponse);
		const result = await controller.remove('1', reqFor('user1'));
		expect(result).toEqual(fakeResponse);
	});

	it('nega leitura do perfil de outro usuário (TRA-89)', async () => {
		await expect(
			controller.findOne('vitima-id', reqFor('atacante-id'))
		).rejects.toThrow(ForbiddenException);
		expect(mockProfileService.findOne).not.toHaveBeenCalled();
	});

	it('permite ao admin ler o perfil de qualquer usuário', async () => {
		mockProfileService.findOne.mockResolvedValue({
			_id: { toString: () => 'profile-id' },
			user: { toString: () => 'vitima-id' },
		});

		await controller.findOne('vitima-id', reqFor('admin-id', 'admin'));
		expect(mockProfileService.findOne).toHaveBeenCalledWith('vitima-id');
	});
});
