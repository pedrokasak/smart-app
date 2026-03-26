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
		forgotPassword: jest.fn(),
		verifyResetToken: jest.fn(),
		resetPassword: jest.fn(),
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

	// --- FORGOT PASSWORD ---
	describe('forgotPassword', () => {
		it('should call authService.forgotPassword', async () => {
			const dto = { email: 'test@test.com' };
			mockAuthService.forgotPassword.mockResolvedValue({ message: 'Success' });
			const result = await controller.forgotPassword(dto);
			expect(authService.forgotPassword).toHaveBeenCalledWith(dto);
			expect(result).toEqual({ message: 'Success' });
		});
	});

	// --- VERIFY RESET TOKEN ---
	describe('verifyResetToken', () => {
		it('should call authService.verifyResetToken', async () => {
			mockAuthService.verifyResetToken.mockResolvedValue({
				valid: true,
				requiresMfa: false,
			});
			const result = await controller.verifyResetToken('mock-token');
			expect(authService.verifyResetToken).toHaveBeenCalledWith('mock-token');
			expect(result).toEqual({ valid: true, requiresMfa: false });
		});
	});

	// --- RESET PASSWORD ---
	describe('resetPassword', () => {
		it('should call authService.resetPassword', async () => {
			const dto = {
				token: 'mock-token',
				newPassword: 'Password123@',
				confirmPassword: 'Password123@',
			};
			mockAuthService.resetPassword.mockResolvedValue({ message: 'Success' });
			const result = await controller.resetPassword(dto);
			expect(authService.resetPassword).toHaveBeenCalledWith(dto);
			expect(result).toEqual({ message: 'Success' });
		});
	});
});
