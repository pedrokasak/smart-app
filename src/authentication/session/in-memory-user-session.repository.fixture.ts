import {
	USER_SESSION_REPOSITORY,
	NewUserSession,
	RotationUpdate,
	StoredUserSession,
	UserSessionRepository,
} from './user-session.repository';
import { USER_SESSION_CLOCK, UserSessionService } from './user-session.service';

/** Repositório em memória para os testes, com as mesmas garantias do Mongo. */
export class InMemoryUserSessionRepository implements UserSessionRepository {
	private readonly sessions = new Map<string, StoredUserSession>();
	private swapLost = false;

	/** Simula outra requisição vencendo a corrida da próxima rotação. */
	loseNextSwap(): void {
		this.swapLost = true;
	}

	async create(session: NewUserSession): Promise<void> {
		this.sessions.set(session.sid, {
			...session,
			previousRefreshTokenHash: null,
			rotatedAt: null,
			recoverableUntil: null,
		});
	}

	async find(sid: string, userId: string): Promise<StoredUserSession | null> {
		const session = this.sessions.get(sid);
		return session?.userId === userId ? { ...session } : null;
	}

	async listByUser(userId: string): Promise<StoredUserSession[]> {
		return [...this.sessions.values()]
			.filter((session) => session.userId === userId)
			.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
	}

	async swapRefreshToken(
		sid: string,
		expectedHash: string,
		update: RotationUpdate
	): Promise<boolean> {
		if (this.swapLost) {
			this.swapLost = false;
			return false;
		}
		const session = this.sessions.get(sid);
		if (!session || session.refreshTokenHash !== expectedHash) return false;
		this.sessions.set(sid, { ...session, ...update });
		return true;
	}

	async deleteOne(sid: string, userId: string): Promise<boolean> {
		const session = this.sessions.get(sid);
		if (session?.userId !== userId) return false;
		return this.sessions.delete(sid);
	}

	async deleteOtherSessionsOfDevice(
		userId: string,
		deviceId: string,
		keepSid: string
	): Promise<void> {
		for (const [sid, session] of this.sessions) {
			if (
				session.userId === userId &&
				session.deviceId === deviceId &&
				sid !== keepSid
			) {
				this.sessions.delete(sid);
			}
		}
	}

	async deleteAllOfUser(userId: string): Promise<void> {
		for (const [sid, session] of this.sessions) {
			if (session.userId === userId) this.sessions.delete(sid);
		}
	}

	async deleteBeyondNewest(userId: string, keep: number): Promise<void> {
		const sessions = await this.listByUser(userId);
		for (const session of sessions.slice(keep)) {
			this.sessions.delete(session.sid);
		}
	}
}

/** Sessões reais sobre o repositório em memória, para módulos de teste. */
export const inMemoryUserSessionProviders = () => [
	UserSessionService,
	{
		provide: USER_SESSION_REPOSITORY,
		useValue: new InMemoryUserSessionRepository(),
	},
	{ provide: USER_SESSION_CLOCK, useValue: () => new Date() },
];
