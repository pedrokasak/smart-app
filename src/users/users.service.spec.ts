import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';
import * as bcrypt from 'bcrypt';
import { HttpException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';

jest.mock('./schema/user.model', () => {
	const mockUserModel = jest.fn().mockImplementation(() => ({
		save: jest.fn(),
	}));

	(mockUserModel as any).findOne = jest.fn();
	(mockUserModel as any).findById = jest.fn();
	(mockUserModel as any).findByIdAndUpdate = jest.fn();
	(mockUserModel as any).findByIdAndDelete = jest.fn();
	(mockUserModel as any).find = jest.fn();

	return { UserModel: mockUserModel };
});

jest.mock('bcrypt');

describe('UsersService', () => {
	let service: UsersService;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let jwtService: JwtService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: 'test-secret' })],
			providers: [UsersService],
		}).compile();

		service = module.get<UsersService>(UsersService);
		jwtService = module.get<JwtService>(JwtService);
	});

	afterEach(() => jest.clearAllMocks());

	describe('create', () => {
		it('deve criar um novo usuário com sucesso', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);
			(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

			const mockSave = jest.fn().mockResolvedValue(true);
			const fakeUser = {
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
			};

			// simula o "new UserModel(...)" e o método save()
			(UserModel as any).mockImplementationOnce(() => ({
				...fakeUser,
				save: mockSave,
			}));

			const result = await service.create({
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
			});

			expect(result.message).toBe('User created successfully');
			expect(mockSave).toHaveBeenCalled();
		});

		it('deve lançar erro se o email já existir', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue({
				email: 'pedro@example.com',
			});

			await expect(
				service.create({
					firstName: 'Pedro',
					lastName: 'SantAnna',
					email: 'pedro@example.com',
					password: '123456',
					confirmPassword: '123456',
				})
			).rejects.toThrow(HttpException);
		});

		it('deve lançar erro se as senhas não coincidirem', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);

			await expect(
				service.create({
					firstName: 'Pedro',
					lastName: 'SantAnna',
					email: 'pedro@example.com',
					password: 'Password123@',
					confirmPassword: 'DifferentPassword123@',
				})
			).rejects.toThrow(HttpException);
		});
	});
});
