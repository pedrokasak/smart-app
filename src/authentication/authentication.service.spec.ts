import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from './authentication.service';

describe('SigninService', () => {
	let service: AuthenticationService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [AuthenticationService],
		}).compile();

		service = module.get<AuthenticationService>(AuthenticationService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
