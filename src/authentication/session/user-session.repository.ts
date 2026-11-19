export const USER_SESSION_PLATFORMS = ['web', 'ios', 'android'] as const;

export type UserSessionPlatform = (typeof USER_SESSION_PLATFORMS)[number];

export interface NewUserSession {
	sid: string;
	userId: string;
	deviceId: string | null;
	deviceName: string | null;
	platform: UserSessionPlatform;
	refreshTokenHash: string;
	lastSeenAt: Date;
	createdAt: Date;
	expiresAt: Date;
}

export interface StoredUserSession extends NewUserSession {
	previousRefreshTokenHash: string | null;
	rotatedAt: Date | null;
	/** Fim da janela de recuperação do token anterior. */
	recoverableUntil: Date | null;
}

export interface RotationUpdate {
	refreshTokenHash: string;
	previousRefreshTokenHash: string | null;
	rotatedAt: Date;
	recoverableUntil: Date | null;
	lastSeenAt: Date;
}

export const USER_SESSION_REPOSITORY = Symbol('USER_SESSION_REPOSITORY');

export interface UserSessionRepository {
	create(session: NewUserSession): Promise<void>;
	find(sid: string, userId: string): Promise<StoredUserSession | null>;
	/** Da sessão usada mais recentemente para a mais antiga. */
	listByUser(userId: string): Promise<StoredUserSession[]>;
	/**
	 * Troca o token só se o digest gravado ainda for `expectedHash`. Devolve
	 * `false` quando outra requisição trocou antes.
	 */
	swapRefreshToken(
		sid: string,
		expectedHash: string,
		update: RotationUpdate
	): Promise<boolean>;
	deleteOne(sid: string, userId: string): Promise<boolean>;
	/** Apaga as outras sessões do aparelho, mantendo `keepSid`. */
	deleteOtherSessionsOfDevice(
		userId: string,
		deviceId: string,
		keepSid: string
	): Promise<void>;
	deleteAllOfUser(userId: string): Promise<void>;
	deleteBeyondNewest(userId: string, keep: number): Promise<void>;
}
