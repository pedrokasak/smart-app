import { Test, TestingModule } from '@nestjs/testing';
import {
	BadRequestException,
	InternalServerErrorException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationService } from './authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { EmailService } from 'src/notifications/email/email.service';
import { UserModel } from 'src/users/schema/user.model';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';

jest.mock('src/users/schema/user.model', () => {
	const mockUserModel = {
		findOne: jest.fn(),
		findById: jest.fn(),
		create: jest.fn(),
		updateOne: jest.fn(),
	};
	return { UserModel: mockUserModel };
});

describe('AuthenticationService', () => {
	let service: AuthenticationService;

	const mockJwtService = {
		sign: jest.fn(),
		verify: jest.fn(),
	};

	const mockTokenBlacklistService = {
		addToBlacklist: jest.fn(),
	};

	const mockEmailService = {
		sendPasswordResetEmail: jest.fn(),
	};

	const mockPasswordSecurityService = {
		hashPassword: jest.fn(),
		verifyPassword: jest.fn(),
		needsRehash: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
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

		service = module.get<AuthenticationService>(AuthenticationService);
	});

	afterEach(() => {
		jest.clearAllMocks();
		(global as any).fetch = undefined;
	});

	describe('signin', () => {
		it('should sign in with correct password', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser = {
				id: 'u1',
				email: 'test@example.com',
				password: 'stored-hash',
				firstName: 'John',
				lastName: 'Doe',
				role: 'user',
				twoFactorEnabled: false,
				save,
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(mockUser),
				}),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(true);
			mockPasswordSecurityService.needsRehash.mockReturnValue(false);
			mockJwtService.sign.mockReturnValue('mocked-token');

			const result = await service.signin({
				email: 'test@example.com',
				password: 'Password123@',
				keepConnected: false,
				token: '',
			});

			expect(mockPasswordSecurityService.verifyPassword).toHaveBeenCalledWith(
				'Password123@',
				'stored-hash'
			);
			expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
			expect(save).toHaveBeenCalled();
			expect(result.accessToken).toBe('mocked-token');
		});

		it('should throw if password is incorrect', async () => {
			const mockUser = {
				id: 'u1',
				email: 'test@example.com',
				password: 'stored-hash',
				twoFactorEnabled: false,
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(mockUser),
				}),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(false);

			await expect(
				service.signin({
					email: 'test@example.com',
					password: 'Wrong123@',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow('Invalid password');
		});

		it('should migrate legacy hash on successful login', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser = {
				id: 'u2',
				email: 'legacy@example.com',
				password: '$2b$10$legacy-hash',
				firstName: 'Legacy',
				lastName: 'User',
				role: 'user',
				twoFactorEnabled: false,
				save,
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(mockUser),
				}),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(true);
			mockPasswordSecurityService.needsRehash.mockReturnValue(true);
			mockPasswordSecurityService.hashPassword.mockResolvedValue('argon2-hash');
			mockJwtService.sign.mockReturnValue('token');

			await service.signin({
				email: 'legacy@example.com',
				password: 'Password123@',
				keepConnected: false,
				token: '',
			});

			expect(mockPasswordSecurityService.hashPassword).toHaveBeenCalledWith(
				'Password123@'
			);
			expect(mockUser.password).toBe('argon2-hash');
			expect(save).toHaveBeenCalledTimes(2);
		});

		it('should throw when user has no password configured', async () => {
			const mockUser = {
				id: 'u3',
				email: 'nopassword@example.com',
				password: undefined,
				twoFactorEnabled: false,
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(mockUser),
				}),
			});

			await expect(
				service.signin({
					email: 'nopassword@example.com',
					password: 'Password123@',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow(InternalServerErrorException);
		});

		it('should throw user not found', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(null),
				}),
			});

			await expect(
				service.signin({
					email: 'missing@example.com',
					password: 'Password123@',
					keepConnected: false,
					token: '',
				})
			).rejects.toThrow(NotFoundException);
		});
	});

	describe('googleSignin', () => {
		it('should sign in existing verified Google user', async () => {
			(global as any).fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					aud: 'any-aud',
					email: 'google@example.com',
					email_verified: 'true',
					given_name: 'Google',
					family_name: 'User',
				}),
			});

			const save = jest.fn().mockResolvedValue(undefined);
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue({
						id: 'u-google',
						email: 'google@example.com',
						firstName: 'Google',
						lastName: 'User',
						role: 'user',
						twoFactorEnabled: false,
						save,
					}),
				}),
			});
			mockJwtService.sign.mockReturnValue('token');

			const result = await service.googleSignin({
				idToken: 'id-token',
				keepConnected: false,
			});

			expect(result.accessToken).toBe('token');
			expect(save).toHaveBeenCalled();
		});

		it('should create user when google account does not exist locally', async () => {
			(global as any).fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					aud: 'any-aud',
					email: 'newgoogle@example.com',
					email_verified: 'true',
					given_name: 'New',
					family_name: 'Google',
					picture: 'https://img.example/avatar.png',
				}),
			});

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(null),
				}),
			});
			mockPasswordSecurityService.hashPassword.mockResolvedValue('argon2-hash');
			const save = jest.fn().mockResolvedValue(undefined);
			(UserModel.create as jest.Mock).mockResolvedValue({
				id: 'u-new-google',
				email: 'newgoogle@example.com',
				firstName: 'New',
				lastName: 'Google',
				role: 'user',
				twoFactorEnabled: false,
				save,
			});
			mockJwtService.sign.mockReturnValue('token');

			const result = await service.googleSignin({
				idToken: 'id-token',
				keepConnected: false,
			});

			expect(UserModel.create).toHaveBeenCalled();
			expect(result.accessToken).toBe('token');
		});

		it('should reject google signin when email is not verified', async () => {
			(global as any).fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					aud: 'any-aud',
					email: 'google@example.com',
					email_verified: 'false',
				}),
			});

			await expect(
				service.googleSignin({
					idToken: 'id-token',
					keepConnected: false,
				})
			).rejects.toThrow(UnauthorizedException);
		});
	});

	describe('forgotPassword', () => {
		it('should return generic response for existing email and send reset email', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser = {
				email: 'test@example.com',
				save,
			};

			(UserModel.findOne as jest.Mock).mockResolvedValue(mockUser);

			const result = await service.forgotPassword({
				email: 'test@example.com',
			});

			expect(result.message).toBe(
				'If the email is valid, a password reset link has been sent'
			);
			expect(save).toHaveBeenCalled();
			expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
				'test@example.com',
				expect.any(String)
			);
		});

		it('should return generic response for unknown email without leaking info', async () => {
			(UserModel.findOne as jest.Mock).mockResolvedValue(null);

			const result = await service.forgotPassword({
				email: 'unknown@example.com',
			});

			expect(result.message).toBe(
				'If the email is valid, a password reset link has been sent'
			);
			expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
		});

		it('should keep generic response when email provider fails', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			(UserModel.findOne as jest.Mock).mockResolvedValue({
				email: 'test@example.com',
				save,
			});
			mockEmailService.sendPasswordResetEmail.mockRejectedValue(
				new Error('provider down')
			);

			const result = await service.forgotPassword({
				email: 'test@example.com',
			});
			expect(result.message).toBe(
				'If the email is valid, a password reset link has been sent'
			);
		});

		it('should rotate reset token on new forgot-password request and keep only latest token valid', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser: any = {
				email: 'test@example.com',
				resetPasswordToken: undefined,
				resetPasswordExpires: undefined,
				save,
			};

			(UserModel.findOne as jest.Mock).mockResolvedValue(mockUser);
			await service.forgotPassword({ email: 'test@example.com' });
			await service.forgotPassword({ email: 'test@example.com' });

			expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(2);
			const firstRawToken = (
				mockEmailService.sendPasswordResetEmail as jest.Mock
			).mock.calls[0][1];
			const secondRawToken = (
				mockEmailService.sendPasswordResetEmail as jest.Mock
			).mock.calls[1][1];
			expect(firstRawToken).not.toBe(secondRawToken);

			const secondHash = mockUser.resetPasswordToken;
			expect(mockUser.resetPasswordToken).toBe(secondHash);
			expect(mockUser.resetPasswordExpires).toBeInstanceOf(Date);

			(UserModel.findOne as jest.Mock).mockImplementation((query: any) => ({
				select: jest.fn().mockResolvedValue(
					query?.resetPasswordToken === secondHash
						? {
								twoFactorEnabled: false,
								resetPasswordExpires: new Date(Date.now() + 60_000),
							}
						: null
				),
			}));

			await expect(service.verifyResetToken(firstRawToken)).rejects.toThrow(
				new UnauthorizedException('Token inválido')
			);
			await expect(service.verifyResetToken(secondRawToken)).resolves.toEqual({
				valid: true,
				requiresMfa: false,
			});
		});
	});

	describe('verifyResetToken', () => {
		it('should validate token', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					twoFactorEnabled: false,
					resetPasswordExpires: new Date(Date.now() + 60_000),
				}),
			});

			const result = await service.verifyResetToken('valid-token');
			expect(result).toEqual({ valid: true, requiresMfa: false });
		});

		it('should throw invalid token', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue(null),
			});

			await expect(service.verifyResetToken('bad-token')).rejects.toThrow(
				new UnauthorizedException('Token inválido')
			);
		});

		it('should throw expired token', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					twoFactorEnabled: false,
					resetPasswordExpires: new Date(Date.now() - 60_000),
				}),
			});

			await expect(service.verifyResetToken('expired-token')).rejects.toThrow(
				new UnauthorizedException('Token expirado')
			);
		});
	});

	describe('resetPassword', () => {
		it('should reset password with valid token', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					twoFactorEnabled: false,
					resetPasswordExpires: new Date(Date.now() + 60_000),
					save,
				}),
			});
			mockPasswordSecurityService.hashPassword.mockResolvedValue('argon2-hash');

			const result = await service.resetPassword({
				token: 'valid-token',
				newPassword: 'Password123@',
				confirmPassword: 'Password123@',
			});

			expect(result.message).toBe('Senha redefinida com sucesso');
			expect(mockPasswordSecurityService.hashPassword).toHaveBeenCalledWith(
				'Password123@'
			);
			expect(save).toHaveBeenCalled();
		});

		it('should fail when token is invalid', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue(null),
			});

			await expect(
				service.resetPassword({
					token: 'invalid-token',
					newPassword: 'Password123@',
					confirmPassword: 'Password123@',
				})
			).rejects.toThrow(new UnauthorizedException('Token inválido'));
		});

		it('should fail when token is expired', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					resetPasswordExpires: new Date(Date.now() - 60_000),
				}),
			});

			await expect(
				service.resetPassword({
					token: 'expired-token',
					newPassword: 'Password123@',
					confirmPassword: 'Password123@',
				})
			).rejects.toThrow(new UnauthorizedException('Token expirado'));
		});

		it('should fail when password confirmation does not match', async () => {
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					twoFactorEnabled: false,
					resetPasswordExpires: new Date(Date.now() + 60_000),
				}),
			});

			await expect(
				service.resetPassword({
					token: 'valid-token',
					newPassword: 'Password123@',
					confirmPassword: 'Password321@',
				})
			).rejects.toThrow(new BadRequestException('As senhas não correspondem'));
		});
	});
});
