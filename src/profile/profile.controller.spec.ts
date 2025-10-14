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
	removeAll: jest.fn(),
};

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
		const result = await controller.create(dto);
		expect(result).toEqual(fakeResponse);
		expect(mockProfileService.create).toHaveBeenCalledWith(dto);
	});

	it('should get all profiles', async () => {
		const fakeProfiles = [{ cpf: '123' }];
		mockProfileService.findAll.mockResolvedValue(fakeProfiles);
		const result = await controller.findAll();
		expect(result).toEqual(fakeProfiles);
	});

	it('should get one profile', async () => {
		const fakeProfile = { cpf: '123' };
		mockProfileService.findOne.mockResolvedValue(fakeProfile);
		const result = await controller.findOne('user1');
		expect(result).toEqual(fakeProfile);
	});

	it('should update a profile', async () => {
		const dto = { cpf: '999', userId: 'user1' };
		const fakeProfile = { cpf: '999' };
		mockProfileService.update.mockResolvedValue(fakeProfile);
		const result = await controller.update('1', dto);
		expect(result).toEqual(fakeProfile);
		expect(mockProfileService.update).toHaveBeenCalledWith('1', dto);
	});

	it('should remove a profile', async () => {
		const fakeResponse = { message: 'Profile deleted successfully', id: '1' };
		mockProfileService.remove.mockResolvedValue(fakeResponse);
		const result = await controller.remove('1');
		expect(result).toEqual(fakeResponse);
	});
});
