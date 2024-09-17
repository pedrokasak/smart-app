import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';

describe('UsersController', () => {
	let controller: UsersController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [UsersController],
			providers: [UsersService],
		}).compile();

		controller = module.get<UsersController>(UsersController);
	});

	it('should be return users list', () => {
		const response = UserModel.find().exec();
		expect(controller).toBe(response);
	});
});
