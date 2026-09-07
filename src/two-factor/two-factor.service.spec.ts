import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { TwoFactorService } from './two-factor.service';
import { AuthenticationService } from 'src/authentication/authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { EmailService } from 'src/notifications/email/email.service';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { UserModel } from 'src/users/schema/user.model';

jest.mock('src/users/schema/user.model', () => ({
	UserModel: {
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
	},
}));

const sha256 = (value: string) =>
	crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * TRA-140: o fluxo de 2FA emitia a sessão por conta própria e gravava o
 * refresh token em texto puro. Estes testes usam o `AuthenticationService`
 * real (não um mock) justamente porque o que está sendo verificado é que os
 * dois fluxos passam pelo mesmo `issueSessionTokens`.
 */
describe('TwoFactorService', () => {
	let service: TwoFactorService;
	let authenticationService: AuthenticationService;

	const mockJwtService = {
		sign: jest.fn(),
		verify: jest.fn(),
	};

	const mockTokenBlacklistService = {
		addToBlacklist: jest.fn().mockResolvedValue(undefined),
		isBlacklisted: jest.fn().mockResolvedValue(false),
	};

	const mockEmailService = { sendPasswordResetEmail: jest.fn() };

	const mockPasswordSecurityService = {
		hashPassword: jest.fn(),
		verifyPassword: jest.fn(),
		needsRehash: jest.fn(),
	};

	const secret = authenticator.generateSecret();

	const buildUser = () => ({
		id: 'u1',
		email: 'user@example.com',
		firstName: 'John',
		lastName: 'Doe',
		role: 'user',
		twoFactorEnabled: true,
		twoFactorSecret: secret,
		refreshToken: null as string | null,
		save: jest.fn().mockResolvedValue(undefined),
	});

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TwoFactorService,
				AuthenticationService,
				{ provide: JwtService, useValue: mockJwtService },
				{ provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
				{ provide: EmailService, useValue: mockEmailService },
				{
					provide: PasswordSecurityService,
					useValue: mockPasswordSecurityService,
				},
			],
		}).compile();

		service = module.get<TwoFactorService>(TwoFactorService);
		authenticationService = module.get<AuthenticationService>(
			AuthenticationService
		);

		mockJwtService.sign.mockImplementation(
			(payload: { type: string }) => `signed.${payload.type}.token`
		);
		mockJwtService.verify.mockReturnValue({
			userId: 'u1',
			type: 'temp_2fa',
			exp: Math.floor(Date.now() / 1000) + 300,
		});
	});

	afterEach(() => {
		jest.clearAllMocks();
		mockTokenBlacklistService.isBlacklisted.mockResolvedValue(false);
	});

	describe('authenticateWithTwoFactor', () => {
		it('stores the SHA-256 digest, never the refresh token in plaintext', async () => {
			const user = buildUser();
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue(user),
			});

			const result = await service.authenticateWithTwoFactor(
				'temp.token',
				authenticator.generate(secret)
			);

			expect(result.refreshToken).toBe('signed.refresh.token');
			expect(user.refreshToken).not.toBe(result.refreshToken);
			expect(user.refreshToken).toBe(sha256(result.refreshToken));
			expect(user.refreshToken).toMatch(/^[0-9a-f]{64}$/);
			expect(user.save).toHaveBeenCalled();
		});

		it('lets a 2FA user refresh the session it just received', async () => {
			const user = buildUser();
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue(user),
			});

			const session = await service.authenticateWithTwoFactor(
				'temp.token',
				authenticator.generate(secret)
			);

			// Segunda etapa: o refresh usa o caminho comum do
			// AuthenticationService, que lê `user.refreshToken` direto.
			(UserModel.findById as jest.Mock).mockResolvedValue(user);
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });

			const refreshed = await authenticationService.refreshAccessToken(
				session.refreshToken
			);

			expect(refreshed.accessToken).toBe('signed.access.token');
			// Formato novo: nada de Argon2 no caminho quente do refresh.
			expect(mockPasswordSecurityService.verifyPassword).not.toHaveBeenCalled();
		});

		it('invalidates the 2FA session on signoutAll', async () => {
			const user = buildUser();
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue(user),
			});

			const session = await service.authenticateWithTwoFactor(
				'temp.token',
				authenticator.generate(secret)
			);

			(UserModel.findById as jest.Mock).mockResolvedValue(user);
			await authenticationService.signoutAll('u1');
			expect(user.refreshToken).toBeNull();

			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			await expect(
				authenticationService.refreshAccessToken(session.refreshToken)
			).rejects.toThrow(UnauthorizedException);
		});

		it('fails closed for a legacy plaintext refresh token still in the database', async () => {
			// Sessões emitidas antes desta correção têm o JWT cru gravado. O
			// verificador legado (Argon2) lança nesse valor e o catch devolve
			// false — logout forçado (401), nunca 500 e nunca sessão aceita.
			const legacyPlaintext = 'header.payload.signature';
			(UserModel.findById as jest.Mock).mockResolvedValue({
				id: 'u1',
				role: 'user',
				refreshToken: legacyPlaintext,
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(false);
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });

			await expect(
				authenticationService.refreshAccessToken(legacyPlaintext)
			).rejects.toThrow(UnauthorizedException);
		});

		it('rejects a temp token whose type is not temp_2fa', async () => {
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'access' });

			await expect(
				service.authenticateWithTwoFactor('temp.token', '000000')
			).rejects.toThrow(UnauthorizedException);
		});
	});
});
