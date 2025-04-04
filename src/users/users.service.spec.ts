import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users/users.service';
import { getModelToken } from '@nestjs/mongoose';

describe('UsersService', () => {
	let service: UsersService;
	let userModelMock: any;

	beforeEach(async () => {
		// Criando um mock do model do usuário
		userModelMock = {
			create: jest
				.fn()
				.mockImplementation((user) =>
					Promise.resolve({ ...user, _id: '12345' })
				),
			findOne: jest.fn().mockResolvedValue(null), // Simula usuário não existente
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				UsersService,
				{
					provide: getModelToken('User'), // Injetando o mock
					useValue: userModelMock,
				},
			],
		}).compile();

		service = module.get<UsersService>(UsersService);
	});

	it('should create a user', async () => {
		const userDto = {
			firstName: 'John',
			lastName: 'Doe',
			email: 'john.doe@example.com',
			password: 'StrongPass1!',
			confirmPassword: 'StrongPass1!',
		};

		const createdUser = await service.create(userDto);

		expect(userModelMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				firstName: 'John',
				lastName: 'Doe',
				email: 'john.doe@example.com',
			})
		);

		expect(createdUser).toHaveProperty('_id');
	});
});
