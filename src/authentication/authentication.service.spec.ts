import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationService } from './authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { EmailService } from 'src/notifications/email/email.service';
import { UserModel } from 'src/users/schema/user.model';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';

jest.mock('src/users/schema/user.model', () => {
	// `updateOne(...)` no serviço é encadeado como `.exec()` (Mongoose), então
	// o mock precisa retornar um objeto com `exec` que resolve. Sem isto, o
	// caminho de sincronização de perfil (ex.: googleSignin) lança
	// `Cannot read properties of undefined (reading 'exec')`.
	const mockUserModel = {
		findOne: jest.fn(),
		findById: jest.fn(),
		create: jest.fn(),
		updateOne: jest.fn().mockReturnValue({
			exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
		}),
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

	const mockBreachedPasswordPolicy = {
		assertNotBreached: jest.fn().mockResolvedValue(undefined),
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
				// TRK-012: dependencia nova de `updatePassword`/`resetPassword`.
				// Stub que sempre aprova — os testes de veredito da politica
				// moram em `breached-password.policy.spec.ts`.
				{
					provide: BreachedPasswordPolicy,
					useValue: mockBreachedPasswordPolicy,
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
			mockPasswordSecurityService.hashPassword.mockResolvedValue(
				'hashed-refresh-token'
			);
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
			).rejects.toThrow('E-mail ou senha inválidos');
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

		// TRA-89: conta sem senha local (criada via Google) não pode se
		// denunciar com um 500 enquanto senha errada devolve 401 — as duas
		// respondem igual.
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
			).rejects.toThrow(UnauthorizedException);
		});

		it('responde igual para e-mail inexistente e senha errada (TRA-89)', async () => {
			// Antes: 404 com o e-mail na mensagem versus 401. Bastava olhar o
			// status pra descobrir quem tem conta na plataforma.
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
			).rejects.toThrow('E-mail ou senha inválidos');
		});

		it('gasta o custo do hash mesmo sem usuário, pra não vazar pelo tempo', async () => {
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
			).rejects.toThrow();

			expect(mockPasswordSecurityService.verifyPassword).toHaveBeenCalled();
		});
	});

	describe('refreshAccessToken', () => {
		it('should issue new access token with valid refresh token', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser = {
				id: 'u1',
				refreshToken: 'hashed-refresh-token',
				role: 'user',
				save,
			};

			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			const select = jest.fn().mockResolvedValue(mockUser);
			(UserModel.findById as jest.Mock).mockReturnValue({ select });
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(true);
			mockJwtService.sign.mockReturnValue('new-access-token');

			const result = await service.refreshAccessToken('raw-refresh-token');

			// `refreshToken` e `select: false`: sem esta projecao o campo volta
			// undefined em producao e nenhuma renovacao funciona.
			expect(select).toHaveBeenCalledWith('+refreshToken');
			expect(mockPasswordSecurityService.verifyPassword).toHaveBeenCalledWith(
				'raw-refresh-token',
				'hashed-refresh-token'
			);
			expect(result.accessToken).toBe('new-access-token');
		});

		it('should throw when stored hash does not match', async () => {
			const mockUser = {
				id: 'u1',
				refreshToken: 'hashed-refresh-token',
				role: 'user',
			};

			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(false);

			await expect(service.refreshAccessToken('wrong-token')).rejects.toThrow(
				UnauthorizedException
			);
		});

		it('should throw when user has no refresh token stored', async () => {
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockResolvedValue({
				id: 'u1',
				refreshToken: null,
				role: 'user',
			});

			await expect(service.refreshAccessToken('any-token')).rejects.toThrow(
				UnauthorizedException
			);
		});

		it('should throw when JWT type is not refresh', async () => {
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'access' });

			await expect(service.refreshAccessToken('access-token')).rejects.toThrow(
				UnauthorizedException
			);
		});

		it('should throw when JWT verification fails', async () => {
			mockJwtService.verify.mockImplementation(() => {
				throw new Error('jwt expired');
			});

			await expect(service.refreshAccessToken('expired-token')).rejects.toThrow(
				UnauthorizedException
			);
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
						_id: 'u-google',
						email: 'google@example.com',
						firstName: 'Google',
						lastName: 'User',
						role: 'user',
						twoFactorEnabled: false,
						save,
					}),
				}),
			});
			(UserModel.updateOne as jest.Mock).mockReturnValue({
				exec: jest
					.fn()
					.mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
			});
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue({
						id: 'u-google',
						_id: 'u-google',
						email: 'google@example.com',
						firstName: 'Google',
						lastName: 'User',
						role: 'user',
						twoFactorEnabled: false,
						save,
					}),
				}),
			});
			// Após sincronizar `isEmailVerified`, o serviço re-busca o user via
			// `findById(...).select('+password').exec()` — precisa estar mockado.
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue({
						id: 'u-google',
						email: 'google@example.com',
						firstName: 'Google',
						lastName: 'User',
						role: 'user',
						twoFactorEnabled: false,
						password: 'no-password-oauth-user',
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

		/**
		 * TRA-151. O `catch` aqui era vazio: uma queda total do provedor de
		 * e-mail não deixava rastro nenhum, e a recuperação de senha — único
		 * caminho de volta de quem perdeu o acesso — falhava em silêncio.
		 */
		it('logs an error when the reset email fails, keeping the generic response', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			(UserModel.findOne as jest.Mock).mockResolvedValue({
				_id: 'user_123',
				email: 'test@example.com',
				save,
			});
			mockEmailService.sendPasswordResetEmail.mockRejectedValueOnce(
				new Error('Email send failed')
			);
			const errorSpy = jest
				.spyOn((service as any).logger, 'error')
				.mockImplementation(() => undefined);

			const result = await service.forgotPassword({
				email: 'test@example.com',
			});

			// Resposta segue idêntica ao caminho de sucesso: variar aqui
			// revelaria quais e-mails existem.
			expect(result.message).toBe(
				'If the email is valid, a password reset link has been sent'
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Falha ao enviar e-mail de recuperação')
			);
			// Log de erro não carrega dado pessoal (CLAUDE.md §8).
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('userId=user_123')
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.not.stringContaining('test@example.com')
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

	// TRA-143: o refresh token deixou de ser hasheado com Argon2 e passou a usar
	// SHA-256. Os testes abaixo cobrem o novo formato, o caminho de leitura dupla
	// para sessões legadas e a revogação.
	describe('refresh token hashing (SHA-256)', () => {
		const sha256 = (value: string) =>
			crypto.createHash('sha256').update(value, 'utf8').digest('hex');

		it('stores the SHA-256 digest of the refresh token on signin, without Argon2', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const mockUser = {
				id: 'u1',
				email: 'test@example.com',
				password: 'stored-hash',
				role: 'user',
				twoFactorEnabled: false,
				refreshToken: null as string | null,
				save,
			};

			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: jest.fn().mockReturnValue({
					exec: jest.fn().mockResolvedValue(mockUser),
				}),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(true);
			mockPasswordSecurityService.needsRehash.mockReturnValue(false);
			mockJwtService.sign.mockReturnValue('signed.jwt.token');

			const result = await service.signin({
				email: 'test@example.com',
				password: 'Password123@',
				keepConnected: false,
				token: '',
			});

			expect(mockUser.refreshToken).toBe(sha256(result.refreshToken));
			expect(mockUser.refreshToken).toMatch(/^[0-9a-f]{64}$/);
			// Uma única operação Argon2 por login: a verificação da senha.
			expect(mockPasswordSecurityService.hashPassword).not.toHaveBeenCalled();
			expect(save).toHaveBeenCalled();
		});

		it('refreshes with a token whose digest matches the stored one', async () => {
			const rawToken = 'valid.refresh.token';
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					id: 'u1',
					role: 'user',
					refreshToken: sha256(rawToken),
				}),
			});
			mockJwtService.sign.mockReturnValue('new-access-token');

			const result = await service.refreshAccessToken(rawToken);

			expect(result.accessToken).toBe('new-access-token');
			// Nenhum Argon2 no caminho do refresh quando o formato já é o novo.
			expect(mockPasswordSecurityService.verifyPassword).not.toHaveBeenCalled();
		});

		it('rejects a valid JWT that is not the stored token', async () => {
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockResolvedValue({
				id: 'u1',
				role: 'user',
				refreshToken: sha256('the.issued.token'),
			});

			await expect(
				service.refreshAccessToken('another.valid.jwt')
			).rejects.toThrow(UnauthorizedException);
		});

		it('rejects after signoutAll clears the stored token', async () => {
			const save = jest.fn().mockResolvedValue(undefined);
			const rawToken = 'valid.refresh.token';
			const storedUser = {
				id: 'u1',
				role: 'user',
				refreshToken: sha256(rawToken) as string | null,
				save,
			};
			(UserModel.findById as jest.Mock).mockResolvedValue(storedUser);

			await service.signoutAll('u1');

			expect(storedUser.refreshToken).toBeNull();
			expect(save).toHaveBeenCalled();

			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });

			await expect(service.refreshAccessToken(rawToken)).rejects.toThrow(
				UnauthorizedException
			);
		});

		it('verifies a legacy Argon2 hash through the dual-read path', async () => {
			const rawToken = 'legacy.refresh.token';
			const legacyHash =
				'$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$aGFzaGVkdmFsdWVoZXJl';

			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					id: 'u1',
					role: 'user',
					refreshToken: legacyHash,
				}),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(true);
			mockJwtService.sign.mockReturnValue('new-access-token');

			const result = await service.refreshAccessToken(rawToken);

			expect(result.accessToken).toBe('new-access-token');
			expect(mockPasswordSecurityService.verifyPassword).toHaveBeenCalledWith(
				rawToken,
				legacyHash
			);
		});

		it('rejects a legacy Argon2 hash that does not match', async () => {
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockResolvedValue({
				id: 'u1',
				role: 'user',
				refreshToken: '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$b3V0cm8',
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(false);

			await expect(service.refreshAccessToken('wrong.token')).rejects.toThrow(
				UnauthorizedException
			);
		});

		it('returns 401 instead of throwing when the stored digest has a different length', async () => {
			// `crypto.timingSafeEqual` lança com buffers de tamanhos diferentes.
			// Um valor truncado no banco tem que virar 401, não 500.
			const rawToken = 'valid.refresh.token';
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'refresh' });
			(UserModel.findById as jest.Mock).mockResolvedValue({
				id: 'u1',
				role: 'user',
				refreshToken: sha256(rawToken).slice(0, 32),
			});
			mockPasswordSecurityService.verifyPassword.mockResolvedValue(false);

			await expect(service.refreshAccessToken(rawToken)).rejects.toThrow(
				UnauthorizedException
			);
		});
	});
});
