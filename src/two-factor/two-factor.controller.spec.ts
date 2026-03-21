import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';

jest.mock('src/env', () => ({
	jwtSecret: 'test-jwt-secret',
	expireKeepAliveConected: '1d',
	expireKeepAliveConectedRefreshToken: '7d',
}));

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

const mockTwoFactorService = {
	setupTwoFactor: jest.fn(),
	enableTwoFactor: jest.fn(),
	disableTwoFactor: jest.fn(),
	authenticateWithTwoFactor: jest.fn(),
};

describe('TwoFactorController', () => {
	let controller: TwoFactorController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [TwoFactorController],
			providers: [
				{ provide: TwoFactorService, useValue: mockTwoFactorService },
			],
		}).compile();

		controller = module.get<TwoFactorController>(TwoFactorController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});

	it('setup() should call setupTwoFactor with userId from JWT', async () => {
		const qrResult = {
			secret: 'ABCDEF',
			qrCodeDataUrl: 'data:image/png;base64,...',
		};
		mockTwoFactorService.setupTwoFactor.mockResolvedValue(qrResult);

		const req = { user: { userId: 'user123' } };
		const result = await controller.setup(req);
		expect(mockTwoFactorService.setupTwoFactor).toHaveBeenCalledWith('user123');
		expect(result).toEqual(qrResult);
	});

	it('verify() should call enableTwoFactor with userId and code', async () => {
		mockTwoFactorService.enableTwoFactor.mockResolvedValue({
			message: '2FA habilitado com sucesso!',
		});

		const req = { user: { userId: 'user123' } };
		const result = await controller.verify(req, { code: '123456' });
		expect(mockTwoFactorService.enableTwoFactor).toHaveBeenCalledWith(
			'user123',
			'123456'
		);
		expect(result.message).toContain('2FA');
	});

	it('authenticate() should call authenticateWithTwoFactor with tempToken and code', async () => {
		const tokens = { accessToken: 'acc', refreshToken: 'ref', expiresIn: '1d' };
		mockTwoFactorService.authenticateWithTwoFactor.mockResolvedValue(tokens);

		const result = await controller.authenticate({
			tempToken: 'tmp123',
			code: '654321',
		});
		expect(mockTwoFactorService.authenticateWithTwoFactor).toHaveBeenCalledWith(
			'tmp123',
			'654321'
		);
		expect(result).toEqual(tokens);
	});
});
