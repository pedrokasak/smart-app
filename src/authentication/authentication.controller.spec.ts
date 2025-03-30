import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';

describe('SigninController', () => {
	let controller: AuthenticationController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AuthenticationController],
			providers: [AuthenticationService],
		}).compile();

		controller = module.get<AuthenticationController>(AuthenticationController);
	});

	it('should be authentication', () => {
		expect(controller).toBeDefined();
	});
});
