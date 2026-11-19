import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationService } from './authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { EmailService } from 'src/notifications/email/email.service';
import { UserModel } from 'src/users/schema/user.model';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';
import { REFRESH_ROTATION_GRACE_MS } from 'src/authentication/session/session-policy';
import { inMemoryUserSessionProviders } from 'src/authentication/session/in-memory-user-session.repository.fixture';

jest.mock('src/users/schema/user.model', () => ({
	UserModel: {
		findOne: jest.fn(),
		findById: jest.fn(),
		updateOne: jest.fn(),
	},
}));

const sha256 = (value: string) =>
	crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/** Sessão (TRA-245): "Manter conectado", rotação do refresh token e logout. */
describe('AuthenticationService — sessão (TRA-245)', () => {
	let service: AuthenticationService;
	const jwt = {
		decode: jest.fn().mockReturnValue({ exp: 4102444800 }),
		sign: jest.fn(),
		verify: jest.fn(),
	};
	const passwords = {
		hashPassword: jest.fn(),
		verifyPassword: jest.fn(),
		needsRehash: jest.fn().mockReturnValue(false),
	};
	const updateOne = UserModel.updateOne as jest.Mock;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AuthenticationService,
				...inMemoryUserSessionProviders(),
				{ provide: JwtService, useValue: jwt },
				{
					provide: TokenBlacklistService,
					useValue: { addToBlacklist: jest.fn() },
				},
				{ provide: EmailService, useValue: {} },
				{ provide: PasswordSecurityService, useValue: passwords },
				{ provide: BreachedPasswordPolicy, useValue: {} },
			],
		}).compile();
		service = module.get(AuthenticationService);
		updateOne.mockReturnValue({
			exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
		});
		jwt.sign.mockImplementation(
			(claims: { type: string }) => `signed-${claims.type}`
		);
	});

	afterEach(() => jest.clearAllMocks());

	const refreshSignOptions = () =>
		jwt.sign.mock.calls.find(([claims]) => claims.type === 'refresh');

	describe('prazo da sessão no login', () => {
		const loginUser = (twoFactorEnabled = false) => ({
			id: 'u1',
			email: 'a@b.c',
			password: 'hash',
			role: 'user',
			twoFactorEnabled,
			save: jest.fn(),
		});

		const mockFindUser = (user: object) =>
			(UserModel.findOne as jest.Mock).mockReturnValue({
				select: () => ({ exec: jest.fn().mockResolvedValue(user) }),
			});

		beforeEach(() => passwords.verifyPassword.mockResolvedValue(true));

		it('sem "Manter conectado" a sessão dura 1 dia', async () => {
			mockFindUser(loginUser());
			await service.signin({
				email: 'a@b.c',
				password: 'x',
				keepConnected: false,
			} as any);

			const [claims, options] = refreshSignOptions()!;
			expect(claims).toMatchObject({ keep: false });
			expect(options).toEqual({ expiresIn: '1d' });
		});

		it('com "Manter conectado" a sessão dura 30 dias', async () => {
			mockFindUser(loginUser());
			await service.signin({
				email: 'a@b.c',
				password: 'x',
				keepConnected: true,
			} as any);

			const [claims, options] = refreshSignOptions()!;
			expect(claims).toMatchObject({ keep: true });
			expect(options).toEqual({ expiresIn: '30d' });
		});

		it('com 2FA, a escolha viaja no tempToken até o código ser confirmado', async () => {
			mockFindUser(loginUser(true));
			await service.signin({
				email: 'a@b.c',
				password: 'x',
				keepConnected: true,
			} as any);

			expect(jwt.sign).toHaveBeenCalledWith(
				{ userId: 'u1', type: 'temp_2fa', keep: true },
				{ expiresIn: '5m' }
			);
		});

		it('login novo preserva os campos legados, que seguem valendo até expirar', async () => {
			const user: any = { ...loginUser(), refreshToken: 'legacy-digest' };
			await service.issueSessionTokens(user);

			expect(user.refreshToken).toBe('legacy-digest');
		});

		it('com 2FA, o aparelho também viaja no tempToken', async () => {
			mockFindUser(loginUser(true));
			const device = {
				deviceId: 'phone-0001',
				deviceName: 'iPhone',
				platform: 'ios',
			};
			await service.signin({
				email: 'a@b.c',
				password: 'x',
				keepConnected: false,
				device,
			} as any);

			expect(jwt.sign).toHaveBeenCalledWith(
				{ userId: 'u1', type: 'temp_2fa', keep: false, device },
				{ expiresIn: '5m' }
			);
		});
	});

	describe('renovação com rotação', () => {
		const current = 'current.refresh.token';
		const previous = 'previous.refresh.token';
		const exp = Math.floor(Date.now() / 1000) + 3600;

		const mockUser = (overrides: object = {}) =>
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({
					id: 'u1',
					role: 'user',
					refreshToken: sha256(current),
					previousRefreshToken: sha256(previous),
					refreshTokenRotatedAt: new Date(),
					...overrides,
				}),
			});

		const revoked = () =>
			updateOne.mock.calls.some(
				([filter, update]) =>
					filter._id === 'u1' && update.$set?.refreshToken === null
			);

		it('gira o refresh token sem esticar a sessão', async () => {
			jwt.verify.mockReturnValue({
				userId: 'u1',
				type: 'refresh',
				keep: true,
				exp,
			});
			mockUser();

			const result = await service.refreshAccessToken(current);

			expect(result.refreshToken).toBe('signed-refresh');
			const [claims, options] = refreshSignOptions()!;
			expect(claims).toEqual({
				userId: 'u1',
				type: 'refresh',
				keep: true,
				jti: expect.any(String),
			});
			expect(options.expiresIn).toBeGreaterThan(3590);
			expect(options.expiresIn).toBeLessThanOrEqual(3600);

			const [filter, update] = updateOne.mock.calls[0];
			expect(filter).toEqual({ _id: 'u1', refreshToken: sha256(current) });
			expect(update.$set.refreshToken).toBe(sha256('signed-refresh'));
			expect(update.$set.previousRefreshToken).toBe(sha256(current));
			expect(update.$set.refreshTokenRotatedAt).toBeInstanceOf(Date);
		});

		it('token emitido antes da mudança (sem `keep`) continua sem a claim', async () => {
			jwt.verify.mockReturnValue({ userId: 'u1', type: 'refresh', exp });
			mockUser();

			await service.refreshAccessToken(current);

			expect(refreshSignOptions()![0]).toEqual({
				userId: 'u1',
				type: 'refresh',
				jti: expect.any(String),
			});
		});

		it('se outra requisição girou antes, segue só com o access token', async () => {
			jwt.verify.mockReturnValue({
				userId: 'u1',
				type: 'refresh',
				keep: false,
				exp,
			});
			mockUser();
			updateOne.mockReturnValueOnce({
				exec: jest
					.fn()
					.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
			});

			const result = await service.refreshAccessToken(current);

			expect(result.accessToken).toBe('signed-access');
			expect(result).not.toHaveProperty('refreshToken');
		});

		it('aceita o token anterior logo depois da rotação (abas concorrentes)', async () => {
			jwt.verify.mockReturnValue({ userId: 'u1', type: 'refresh', exp });
			mockUser();

			const result = await service.refreshAccessToken(previous);

			expect(result.accessToken).toBe('signed-access');
			expect(result).not.toHaveProperty('refreshToken');
			expect(revoked()).toBe(false);
		});

		it('token anterior fora da janela é reuso: derruba a sessão', async () => {
			jwt.verify.mockReturnValue({ userId: 'u1', type: 'refresh', exp });
			mockUser({
				refreshTokenRotatedAt: new Date(
					Date.now() - REFRESH_ROTATION_GRACE_MS - 1000
				),
			});

			await expect(service.refreshAccessToken(previous)).rejects.toThrow(
				UnauthorizedException
			);
			expect(revoked()).toBe(true);
		});

		it('token desconhecido também derruba a sessão', async () => {
			jwt.verify.mockReturnValue({ userId: 'u1', type: 'refresh', exp });
			mockUser();

			await expect(
				service.refreshAccessToken('stolen.other.token')
			).rejects.toThrow(UnauthorizedException);
			expect(revoked()).toBe(true);
		});

		it('depois de revogada, nem o token anterior renova', async () => {
			jwt.verify.mockReturnValue({ userId: 'u1', type: 'refresh', exp });
			mockUser({ refreshToken: null });

			await expect(service.refreshAccessToken(previous)).rejects.toThrow(
				UnauthorizedException
			);
		});
	});

	it('dois refresh emitidos no mesmo segundo saem diferentes (jti)', () => {
		const real = new JwtService({ secret: 'spec-secret' });
		jwt.sign.mockImplementation((claims: object, options: object) =>
			real.sign(claims, options)
		);
		const user: any = {
			id: 'u1',
			role: 'user',
			save: jest.fn(),
		};

		const first = service.issueSessionTokens(user);
		const second = service.issueSessionTokens(user);

		return Promise.all([first, second]).then(([a, b]) => {
			expect(a.refreshToken).not.toBe(b.refreshToken);
			expect(real.decode(a.refreshToken).jti).toEqual(expect.any(String));
		});
	});

	describe('sessão por dispositivo', () => {
		const real = new JwtService({ secret: 'spec-secret' });
		const user = () =>
			({ id: 'u1', email: 'a@b.c', role: 'user', save: jest.fn() }) as any;

		beforeEach(() => {
			jwt.sign.mockImplementation((claims: object, options: object) =>
				real.sign(claims, options as any)
			);
			jwt.verify.mockImplementation((token: string, options?: object) =>
				real.verify(token, options as any)
			);
			(jwt as any).decode.mockImplementation((token: string) =>
				real.decode(token)
			);
			(UserModel.findById as jest.Mock).mockReturnValue({
				select: jest.fn().mockResolvedValue({ id: 'u1', role: 'user' }),
			});
		});

		afterEach(() => {
			(jwt as any).decode.mockReturnValue({ exp: 4102444800 });
			(jwt as any).decode.mockImplementation(() => ({ exp: 4102444800 }));
		});

		it('login em um aparelho não derruba o outro', async () => {
			const web = await service.issueSessionTokens(user());
			const phone = await service.issueSessionTokens(user(), {
				device: {
					deviceId: 'phone-0001',
					deviceName: 'iPhone',
					platform: 'ios',
				},
			});

			await expect(
				service.refreshAccessToken(web.refreshToken)
			).resolves.toHaveProperty('refreshToken');
			await expect(
				service.refreshAccessToken(phone.refreshToken)
			).resolves.toHaveProperty('refreshToken');
		});

		it('o access token renovado segue ligado à mesma sessão', async () => {
			const session = await service.issueSessionTokens(user());
			const { sid } = real.decode(session.refreshToken);

			const renewed = await service.refreshAccessToken(session.refreshToken);

			expect(real.decode(session.accessToken).sid).toBe(sid);
			expect(real.decode(renewed.accessToken).sid).toBe(sid);
			expect(real.decode(renewed.refreshToken!).sid).toBe(sid);
		});

		it('logout encerra só aquele aparelho, sem tocar nos campos legados', async () => {
			const first = await service.issueSessionTokens(user());
			const second = await service.issueSessionTokens(user());
			updateOne.mockClear();

			await service.signout(first.accessToken);

			await expect(
				service.refreshAccessToken(first.refreshToken)
			).rejects.toThrow(UnauthorizedException);
			await expect(
				service.refreshAccessToken(second.refreshToken)
			).resolves.toBeDefined();
			expect(updateOne).not.toHaveBeenCalledWith(
				{ _id: 'u1' },
				expect.objectContaining({
					$set: expect.objectContaining({ refreshToken: null }),
				})
			);
		});

		it('reuso derruba só a sessão comprometida', async () => {
			const stolen = await service.issueSessionTokens(user());
			const other = await service.issueSessionTokens(user());
			const second = await service.refreshAccessToken(stolen.refreshToken);
			const third = await service.refreshAccessToken(second.refreshToken!);
			expect(third.refreshToken).toBeDefined();

			await expect(
				service.refreshAccessToken(stolen.refreshToken)
			).rejects.toThrow(UnauthorizedException);

			await expect(
				service.refreshAccessToken(third.refreshToken!)
			).rejects.toThrow(UnauthorizedException);
			await expect(
				service.refreshAccessToken(other.refreshToken)
			).resolves.toBeDefined();
		});

		it('resposta de rotação perdida não encerra a sessão', async () => {
			const session = await service.issueSessionTokens(user());
			await service.refreshAccessToken(session.refreshToken);

			const later = Date.now() + REFRESH_ROTATION_GRACE_MS + 1000;
			jest.useFakeTimers({
				now: later,
				doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
			});

			const recovered = await service.refreshAccessToken(session.refreshToken);
			jest.useRealTimers();

			expect(recovered.refreshToken).toBeDefined();
		});

		it('signoutAll encerra todas as sessões', async () => {
			const session = await service.issueSessionTokens(user());
			(UserModel.findById as jest.Mock).mockResolvedValueOnce(user());

			await service.signoutAll('u1');

			await expect(
				service.refreshAccessToken(session.refreshToken)
			).rejects.toThrow(UnauthorizedException);
		});
	});

	it('logout encerra a renovação no servidor', async () => {
		jwt.verify.mockReturnValue({ userId: 'u1', type: 'access', exp: 123 });

		await service.signout('access.token');

		expect(updateOne).toHaveBeenCalledWith(
			{ _id: 'u1' },
			{
				$set: {
					refreshToken: null,
					previousRefreshToken: null,
					refreshTokenRotatedAt: null,
				},
			}
		);
	});
});
