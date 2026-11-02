import { Inject, Injectable, Optional } from '@nestjs/common';
import {
	SECURITY_AUDIT,
	SecurityAudit,
} from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import {
	hashRefreshToken,
	matchesRefreshTokenDigest,
} from 'src/authentication/security/refresh-token-hash';
import {
	MAX_SESSIONS_PER_USER,
	REFRESH_RECOVERY_WINDOW_MS,
	isWithinRotationGrace,
} from './session-policy';
import {
	USER_SESSION_REPOSITORY,
	UserSessionPlatform,
	UserSessionRepository,
} from './user-session.repository';

export const USER_SESSION_CLOCK = Symbol('USER_SESSION_CLOCK');

/** Aparelho que abriu a sessão. O web não informa: vira plataforma `web`. */
export interface SessionDevice {
	deviceId: string;
	deviceName: string;
	platform: Extract<UserSessionPlatform, 'ios' | 'android'>;
}

export interface OpenSessionInput {
	sid: string;
	userId: string;
	refreshToken: string;
	expiresAt: Date;
	device?: SessionDevice;
}

export interface RenewSessionInput {
	sid: string;
	userId: string;
	presentedToken: string;
	/** Assina o próximo refresh token. Só é chamado quando há o que girar. */
	issueSuccessor: () => string;
}

export type SessionRenewal =
	| { outcome: 'rotated'; refreshToken: string }
	| { outcome: 'access_only' }
	| { outcome: 'reused' }
	| { outcome: 'unknown_session' };

/** O que o dono da conta vê das próprias sessões. Nunca inclui digest. */
export interface UserSessionView {
	id: string;
	deviceName: string | null;
	platform: UserSessionPlatform;
	createdAt: Date;
	lastSeenAt: Date;
}

export type SessionRevocationReason =
	| 'signout'
	| 'user_request'
	| 'signout_all'
	| 'password_changed';

/**
 * Sessões por dispositivo (ADR-001, Revisão 1). Cada login abre uma sessão, e
 * revogar uma não afeta as outras.
 */
@Injectable()
export class UserSessionService {
	constructor(
		@Inject(USER_SESSION_REPOSITORY)
		private readonly repository: UserSessionRepository,
		@Inject(USER_SESSION_CLOCK) private readonly clock: () => Date,
		@Optional()
		@Inject(SECURITY_AUDIT)
		private readonly securityAudit?: SecurityAudit
	) {}

	async open(input: OpenSessionInput): Promise<void> {
		const now = this.clock();
		const { device } = input;
		await this.repository.create({
			sid: input.sid,
			userId: input.userId,
			deviceId: device?.deviceId ?? null,
			deviceName: device?.deviceName ?? null,
			platform: device?.platform ?? 'web',
			refreshTokenHash: hashRefreshToken(input.refreshToken),
			lastSeenAt: now,
			createdAt: now,
			expiresAt: input.expiresAt,
		});
		// Login repetido no mesmo aparelho substitui a sessão dele. Só depois de
		// criar a nova: uma falha aqui não pode deixar o aparelho deslogado.
		if (device) {
			await this.repository.deleteOtherSessionsOfDevice(
				input.userId,
				device.deviceId,
				input.sid
			);
		}
		await this.repository.deleteBeyondNewest(
			input.userId,
			MAX_SESSIONS_PER_USER
		);
	}

	/**
	 * Renova a sessão apresentando o refresh token.
	 *
	 * - Token atual: gira.
	 * - Token anterior, dentro da janela: requisição concorrente. Devolve só
	 *   access token, porque girar de novo invalidaria o token que a outra
	 *   requisição acabou de receber.
	 * - Token anterior, até `recoverableUntil`: a resposta da rotação se perdeu,
	 *   caso comum em rede móvel. É seguro recuperar porque `previous` só
	 *   continua sendo este token enquanto o sucessor nunca foi usado: o primeiro
	 *   uso o substituiria. Se um ladrão usar este caminho, o dono apresenta o
	 *   sucessor antigo depois e cai no reuso, derrubando os dois. O prazo não se
	 *   renova com a recuperação, então usar o token antigo não o estende.
	 * - Qualquer outro token: reuso. Só esta sessão cai.
	 */
	async renew(input: RenewSessionInput): Promise<SessionRenewal> {
		const { sid, userId, presentedToken, issueSuccessor } = input;
		const session = await this.repository.find(sid, userId);
		if (!session) return { outcome: 'unknown_session' };

		const now = this.clock();
		const currentHash = session.refreshTokenHash;
		const previousHash = session.previousRefreshTokenHash;

		if (matchesRefreshTokenDigest(presentedToken, currentHash)) {
			return this.swap(sid, currentHash, issueSuccessor, now, {
				previousHash: currentHash,
				recoverableUntil: new Date(now.getTime() + REFRESH_RECOVERY_WINDOW_MS),
			});
		}

		if (
			previousHash &&
			matchesRefreshTokenDigest(presentedToken, previousHash)
		) {
			if (isWithinRotationGrace(session.rotatedAt, now.getTime())) {
				return { outcome: 'access_only' };
			}
			if (session.recoverableUntil && now <= session.recoverableUntil) {
				return this.swap(sid, currentHash, issueSuccessor, now, {
					previousHash,
					recoverableUntil: session.recoverableUntil,
				});
			}
		}

		await this.repository.deleteOne(sid, userId);
		this.securityAudit?.emit({
			type: SECURITY_EVENT.SessionReuseDetected,
			actor: { userId },
			payload: { platform: session.platform },
		});
		return { outcome: 'reused' };
	}

	private async swap(
		sid: string,
		expectedHash: string,
		issueSuccessor: () => string,
		now: Date,
		previous: { previousHash: string; recoverableUntil: Date }
	): Promise<SessionRenewal> {
		const refreshToken = issueSuccessor();
		const swapped = await this.repository.swapRefreshToken(sid, expectedHash, {
			refreshTokenHash: hashRefreshToken(refreshToken),
			previousRefreshTokenHash: previous.previousHash,
			rotatedAt: now,
			recoverableUntil: previous.recoverableUntil,
			lastSeenAt: now,
		});
		return swapped
			? { outcome: 'rotated', refreshToken }
			: { outcome: 'access_only' };
	}

	async listForUser(userId: string): Promise<UserSessionView[]> {
		const sessions = await this.repository.listByUser(userId);
		return sessions.map((session) => ({
			id: session.sid,
			deviceName: session.deviceName,
			platform: session.platform,
			createdAt: session.createdAt,
			lastSeenAt: session.lastSeenAt,
		}));
	}

	/** Devolve `false` se a sessão não existe ou não é deste usuário. */
	async revoke(
		sid: string,
		userId: string,
		reason: SessionRevocationReason = 'signout'
	): Promise<boolean> {
		const deleted = await this.repository.deleteOne(sid, userId);
		if (deleted) this.auditRevocation(userId, reason);
		return deleted;
	}

	async revokeAll(
		userId: string,
		reason: SessionRevocationReason = 'signout_all'
	): Promise<void> {
		await this.repository.deleteAllOfUser(userId);
		this.auditRevocation(userId, reason);
	}

	private auditRevocation(
		userId: string,
		reason: SessionRevocationReason
	): void {
		this.securityAudit?.emit({
			type: SECURITY_EVENT.SessionRevoked,
			actor: { userId },
			payload: { reason },
		});
	}
}
