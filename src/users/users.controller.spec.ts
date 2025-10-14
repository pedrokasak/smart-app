import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { HttpException } from '@nestjs/common';
import { CreateUserDto } from 'src/users/dto/create-user.dto';

const mockUsersService = {
	create: jest.fn(),
	findMany: jest.fn(),
	findOne: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
};

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));
describe('UsersController', () => {
	let controller: UsersController;
	let service: typeof mockUsersService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [UsersController],
			providers: [{ provide: UsersService, useValue: mockUsersService }],
		}).compile();

		controller = module.get<UsersController>(UsersController);
		service = module.get(UsersService);
	});

	afterEach(() => jest.clearAllMocks());

	describe('create', () => {
		it('deve criar um usuário com sucesso', async () => {
			const dto: CreateUserDto = {
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
			};

			const fakeResponse = {
				message: 'User created successfully',
				user: { ...dto, _id: 'abc123' },
				accessToken: 'fakeAccessToken',
			};

			service.create.mockResolvedValue(fakeResponse);

			const result = await controller.create(dto);

			expect(result).toEqual(fakeResponse);
			expect(service.create).toHaveBeenCalledWith(dto);
		});

		it('deve lançar HttpException quando o service falhar', async () => {
			const dto: CreateUserDto = {
				firstName: 'Pedro',
				lastName: 'SantAnna',
				email: 'pedro@example.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
			};

			service.create.mockRejectedValue(new HttpException('Erro', 400));

			await expect(controller.create(dto)).rejects.toThrow(HttpException);
		});
	});

	describe('findAll', () => {
		it('deve retornar todos os usuários', async () => {
			const users = [
				{ _id: '1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
			];
			service.findMany.mockResolvedValue(users);

			const result = await controller.findAll();

			expect(result).toEqual(users);
			expect(service.findMany).toHaveBeenCalled();
		});
	});

	describe('findOne', () => {
		it('deve retornar um usuário pelo ID', async () => {
			const user = {
				_id: '1',
				firstName: 'A',
				lastName: 'B',
				email: 'a@b.com',
			};
			service.findOne.mockResolvedValue(user);

			const result = await controller.findOne('1');

			expect(result).toEqual(user);
			expect(service.findOne).toHaveBeenCalledWith('1');
		});
	});

	describe('update', () => {
		it('deve atualizar um usuário', async () => {
			const dto: UpdateUserDto = {
				firstName: 'Updated',
				lastName: 'User',
				email: 'teste@user.com',
				password: 'Password123@',
				confirmPassword: 'Password123@',
			};
			const updatedUser = { _id: '1', firstName: 'Updated 2' };
			service.update.mockResolvedValue(updatedUser);

			const result = await controller.update('1', dto);

			expect(result).toEqual(updatedUser);
			expect(service.update).toHaveBeenCalledWith('1', dto);
		});
	});

	describe('remove', () => {
		it('deve remover um usuário', async () => {
			service.delete.mockResolvedValue({ deleted: true });

			const result = await controller.remove('1');

			expect(result).toEqual({ deleted: true });
			expect(service.delete).toHaveBeenCalledWith('1');
		});
	});
});
