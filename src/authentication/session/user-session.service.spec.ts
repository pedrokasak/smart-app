import { hashRefreshToken } from 'src/authentication/security/refresh-token-hash';
import {
	MAX_SESSIONS_PER_USER,
	REFRESH_RECOVERY_WINDOW_MS,
	REFRESH_ROTATION_GRACE_MS,
} from './session-policy';
import { InMemoryUserSessionRepository } from './in-memory-user-session.repository.fixture';
import { UserSessionService } from './user-session.service';

const EXPIRES_AT = new Date('2030-01-01T00:00:00Z');

describe('UserSessionService', () => {
	let repository: InMemoryUserSessionRepository;
	let service: UserSessionService;
	let now: Date;

	beforeEach(() => {
		repository = new InMemoryUserSessionRepository();
		now = new Date('2026-11-02T12:00:00Z');
		service = new UserSessionService(repository, () => now);
	});

	const open = (overrides: object = {}) =>
		service.open({
			sid: 's1',
			userId: 'u1',
			refreshToken: 'token-1',
			expiresAt: EXPIRES_AT,
			...overrides,
		});

	const renew = (presented: string, next = 'next-token', sid = 's1') =>
		service.renew({
			sid,
			userId: 'u1',
			presentedToken: presented,
			issueSuccessor: () => next,
		});

	const advance = (ms: number) => {
		now = new Date(now.getTime() + ms);
	};

	describe('abertura', () => {
		it('sem dados de aparelho, a sessão é do web e guarda só o digest', async () => {
			await open();

			const stored = await repository.find('s1', 'u1');
			expect(stored).toMatchObject({
				platform: 'web',
				refreshTokenHash: hashRefreshToken('token-1'),
				previousRefreshTokenHash: null,
				expiresAt: EXPIRES_AT,
			});
			expect(JSON.stringify(stored)).not.toContain('token-1');
		});

		it('duas sessões do mesmo usuário convivem', async () => {
			await open();
			await open({ sid: 's2', refreshToken: 'token-2' });

			expect(await renew('token-1', 'a')).toEqual({
				outcome: 'rotated',
				refreshToken: 'a',
			});
			expect(await renew('token-2', 'b', 's2')).toEqual({
				outcome: 'rotated',
				refreshToken: 'b',
			});
		});

		it('login de novo no mesmo aparelho substitui a sessão dele', async () => {
			const device = {
				deviceId: 'phone-1',
				deviceName: 'iPhone',
				platform: 'ios' as const,
			};
			await open({ device });
			await open({ sid: 's2', refreshToken: 'token-2', device });

			expect(await repository.find('s1', 'u1')).toBeNull();
			expect(await repository.find('s2', 'u1')).not.toBeNull();
		});

		it('se criar a sessão nova falhar, o aparelho segue com a atual', async () => {
			const device = {
				deviceId: 'phone-1',
				deviceName: 'iPhone',
				platform: 'ios' as const,
			};
			await open({ device });
			jest.spyOn(repository, 'create').mockRejectedValueOnce(new Error('down'));

			await expect(
				open({ sid: 's2', refreshToken: 'token-2', device })
			).rejects.toThrow('down');

			expect(await repository.find('s1', 'u1')).not.toBeNull();
		});

		it('passando do teto, cai a sessão usada há mais tempo', async () => {
			for (let i = 0; i <= MAX_SESSIONS_PER_USER; i += 1) {
				await open({ sid: `s${i}`, refreshToken: `token-${i}` });
				advance(1000);
			}

			expect(await repository.find('s0', 'u1')).toBeNull();
			expect(await service.listForUser('u1')).toHaveLength(
				MAX_SESSIONS_PER_USER
			);
		});
	});

	describe('renovação', () => {
		beforeEach(() => open());

		it('token atual gira e guarda o anterior', async () => {
			expect(await renew('token-1')).toEqual({
				outcome: 'rotated',
				refreshToken: 'next-token',
			});

			expect(await repository.find('s1', 'u1')).toMatchObject({
				refreshTokenHash: hashRefreshToken('next-token'),
				previousRefreshTokenHash: hashRefreshToken('token-1'),
				rotatedAt: now,
				lastSeenAt: now,
			});
		});

		it('se outra requisição girou antes, segue só com access token', async () => {
			repository.loseNextSwap();

			expect(await renew('token-1')).toEqual({ outcome: 'access_only' });
		});

		it('token anterior dentro da janela não gira de novo (abas concorrentes)', async () => {
			await renew('token-1');

			expect(await renew('token-1', 'other')).toEqual({
				outcome: 'access_only',
			});
			expect((await repository.find('s1', 'u1'))!.refreshTokenHash).toBe(
				hashRefreshToken('next-token')
			);
		});

		it('resposta perdida: fora da janela, recupera com um sucessor', async () => {
			await renew('token-1', 'lost-token');
			advance(REFRESH_ROTATION_GRACE_MS + 1000);

			expect(await renew('token-1', 'recovered')).toEqual({
				outcome: 'rotated',
				refreshToken: 'recovered',
			});
			expect(await renew('recovered', 'after')).toEqual({
				outcome: 'rotated',
				refreshToken: 'after',
			});
		});

		it('fora da janela de recuperação, o token anterior é reuso', async () => {
			await renew('token-1', 'unused-successor');
			advance(REFRESH_RECOVERY_WINDOW_MS + 1000);

			expect(await renew('token-1')).toEqual({ outcome: 'reused' });
			expect(await repository.find('s1', 'u1')).toBeNull();
		});

		it('recuperar não estende a janela de recuperação', async () => {
			await renew('token-1', 'lost-1');
			advance(REFRESH_RECOVERY_WINDOW_MS - 1000);
			await renew('token-1', 'lost-2');
			advance(REFRESH_ROTATION_GRACE_MS + 1000);

			expect(await renew('token-1')).toEqual({ outcome: 'reused' });
		});

		it('depois da recuperação, o sucessor perdido é reuso', async () => {
			await renew('token-1', 'lost-token');
			advance(REFRESH_ROTATION_GRACE_MS + 1000);
			await renew('token-1', 'recovered');

			expect(await renew('lost-token')).toEqual({ outcome: 'reused' });
			expect(await repository.find('s1', 'u1')).toBeNull();
		});

		it('sucessor já usado: token antigo é reuso e derruba só esta sessão', async () => {
			await open({ sid: 's2', refreshToken: 'other-device' });
			await renew('token-1', 'token-2');
			await renew('token-2', 'token-3');
			advance(REFRESH_ROTATION_GRACE_MS + 1000);

			expect(await renew('token-1')).toEqual({ outcome: 'reused' });
			expect(await repository.find('s1', 'u1')).toBeNull();
			expect(await repository.find('s2', 'u1')).not.toBeNull();
		});

		it('sessão inexistente é recusada sem emitir token', async () => {
			const issueSuccessor = jest.fn();

			const result = await service.renew({
				sid: 'nope',
				userId: 'u1',
				presentedToken: 'token-1',
				issueSuccessor,
			});

			expect(result).toEqual({ outcome: 'unknown_session' });
			expect(issueSuccessor).not.toHaveBeenCalled();
		});

		it('sessão de outro usuário é recusada', async () => {
			const result = await service.renew({
				sid: 's1',
				userId: 'intruder',
				presentedToken: 'token-1',
				issueSuccessor: () => 'x',
			});

			expect(result).toEqual({ outcome: 'unknown_session' });
			expect(await repository.find('s1', 'u1')).not.toBeNull();
		});
	});

	describe('encerramento', () => {
		beforeEach(async () => {
			await open();
			await open({ sid: 's2', refreshToken: 'token-2' });
		});

		it('revoga só a sessão pedida, e só do próprio dono', async () => {
			expect(await service.revoke('s1', 'intruder')).toBe(false);
			expect(await repository.find('s1', 'u1')).not.toBeNull();

			expect(await service.revoke('s1', 'u1')).toBe(true);
			expect(await repository.find('s1', 'u1')).toBeNull();
			expect(await repository.find('s2', 'u1')).not.toBeNull();
		});

		it('revokeAll encerra todas as sessões do usuário', async () => {
			await service.revokeAll('u1');

			expect(await service.listForUser('u1')).toEqual([]);
		});
	});

	describe('credencial de biometria', () => {
		const device = {
			deviceId: 'phone-1',
			deviceName: 'Pixel',
			platform: 'android' as const,
		};
		let credentials: { deleteForDevice: jest.Mock; deleteAllOfUser: jest.Mock };

		beforeEach(async () => {
			credentials = { deleteForDevice: jest.fn(), deleteAllOfUser: jest.fn() };
			service = new UserSessionService(
				repository,
				() => now,
				undefined,
				credentials as never
			);
			await open({ sid: 's1', device });
		});

		it('sobrevive ao logout do próprio aparelho', async () => {
			await service.revoke('s1', 'u1');

			expect(credentials.deleteForDevice).not.toHaveBeenCalled();
		});

		it('cai quando o aparelho é encerrado pela lista de sessões', async () => {
			await service.revoke('s1', 'u1', 'user_request');

			expect(credentials.deleteForDevice).toHaveBeenCalledWith(
				'u1',
				'phone-1'
			);
		});

		it('não é tocada ao tentar encerrar a sessão de outra conta', async () => {
			await service.revoke('s1', 'u2', 'user_request');

			expect(credentials.deleteForDevice).not.toHaveBeenCalled();
		});

		it('cai junto com todas as sessões, como na troca de senha', async () => {
			await service.revokeAll('u1', 'password_changed');

			expect(credentials.deleteAllOfUser).toHaveBeenCalledWith('u1');
		});
	});

	it('a listagem não expõe hash de token', async () => {
		await open({
			device: { deviceId: 'd', deviceName: 'Pixel', platform: 'android' },
		});

		const [session] = await service.listForUser('u1');

		expect(session).toEqual({
			id: 's1',
			deviceName: 'Pixel',
			platform: 'android',
			createdAt: now,
			lastSeenAt: now,
		});
	});
});
