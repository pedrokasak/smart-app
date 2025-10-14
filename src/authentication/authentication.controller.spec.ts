import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { UnauthorizedException } from '@nestjs/common';
import { AuthenticateDto } from 'src/authentication/dto/authenticate.dto';

jest.mock('../env.ts', () => ({
	jwtSecret: 'fakeJwtSecretsdadxczxc,mfnlfnvlvnvlzmxcmv',
}));

jest.mock('./jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

describe('AuthenticationController', () => {
	let controller: AuthenticationController;
	let authService: AuthenticationService;

	const mockAuthService = {
		signin: jest.fn(),
		signout: jest.fn(),
		refreshAccessToken: jest.fn(),
		updatePassword: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AuthenticationController],
			providers: [
				{ provide: AuthenticationService, useValue: mockAuthService },
			],
		}).compile();

		controller = module.get<AuthenticationController>(AuthenticationController);
		authService = module.get<AuthenticationService>(AuthenticationService);

		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	// --- SIGNIN ---
	describe('signin', () => {
		it('should call authService.signin and return result', async () => {
			const dto: AuthenticateDto = {
				email: 'test@example.com',
				password: '123456',
				keepConnected: false,
				token: '',
			};
			const expected = { accessToken: 'abc', refreshToken: 'xyz' };
			mockAuthService.signin.mockResolvedValue(expected);

			const result = await controller.signin(dto);

			expect(authService.signin).toHaveBeenCalledWith(dto);
			expect(result).toEqual(expected);
		});
	});

	// --- SIGNOUT ---
	describe('signout', () => {
		it('should call authService.signout with token', async () => {
			const dto = { token: 'mocked-token' };
			mockAuthService.signout.mockResolvedValue({ success: true });

			const result = await controller.signout(dto);

			expect(authService.signout).toHaveBeenCalledWith('mocked-token');
			expect(result).toEqual({ success: true });
		});
	});

	// --- REFRESH TOKEN ---
	describe('refreshToken', () => {
		it('should return result when refresh token is valid', async () => {
			const dto = { refreshToken: 'valid-token' };
			const expected = { accessToken: 'new-access', expiresIn: '30m' };
			mockAuthService.refreshAccessToken.mockResolvedValue(expected);

			const result = await controller.refreshToken(dto);

			expect(authService.refreshAccessToken).toHaveBeenCalledWith(
				'valid-token'
			);
			expect(result).toEqual(expected);
		});

		it('should throw UnauthorizedException if token is missing', async () => {
			await expect(
				controller.refreshToken({ refreshToken: '' })
			).rejects.toThrow(UnauthorizedException);
		});

		it('should throw UnauthorizedException if service throws', async () => {
			mockAuthService.refreshAccessToken.mockRejectedValue(
				new Error('expired')
			);

			await expect(
				controller.refreshToken({ refreshToken: 'bad' })
			).rejects.toThrow(UnauthorizedException);
		});
	});

	// --- UPDATE PASSWORD ---
	describe('updatePassword', () => {
		it('should call authService.updatePassword with correct args', async () => {
			const req = { user: { userId: 'user123' } };
			const dto = { oldPassword: '123', newPassword: '456' };
			mockAuthService.updatePassword.mockResolvedValue({ success: true });

			const result = await controller.updatePassword(req, dto);

			expect(authService.updatePassword).toHaveBeenCalledWith('user123', dto);
			expect(result).toEqual({ success: true });
		});
	});
});
