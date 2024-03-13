import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from 'src/database/prisma.service';

describe('UsersController', () => {
	let controller: UsersController;
	const prisma = new PrismaService();

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [UsersController],
			providers: [UsersService],
		}).compile();

		controller = module.get<UsersController>(UsersController);
	});

	it('should be return users list', () => {
		const response = prisma.user.findMany();
		expect(controller).toBe(response);
	});
});
