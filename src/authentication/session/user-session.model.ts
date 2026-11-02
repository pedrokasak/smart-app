import { Schema, Types, model } from 'mongoose';
import {
	USER_SESSION_PLATFORMS,
	UserSessionPlatform,
} from './user-session.repository';

/**
 * Sessão de UM login em UM aparelho (ADR-001, Revisão 1). Um usuário tem N
 * documentos aqui. Guarda só digests de refresh token, nunca o token.
 */
export interface UserSession {
	_id?: Types.ObjectId;
	sid: string;
	user: Types.ObjectId;
	deviceId: string | null;
	deviceName: string | null;
	platform: UserSessionPlatform;
	refreshTokenHash: string;
	previousRefreshTokenHash: string | null;
	rotatedAt: Date | null;
	recoverableUntil: Date | null;
	lastSeenAt: Date;
	createdAt: Date;
	expiresAt: Date;
}

const userSessionSchema = new Schema<UserSession>(
	{
		sid: { type: String, required: true, unique: true },
		user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		deviceId: { type: String, default: null },
		deviceName: { type: String, default: null },
		platform: { type: String, enum: USER_SESSION_PLATFORMS, required: true },
		refreshTokenHash: { type: String, required: true },
		previousRefreshTokenHash: { type: String, default: null },
		rotatedAt: { type: Date, default: null },
		recoverableUntil: { type: Date, default: null },
		lastSeenAt: { type: Date, required: true },
		createdAt: { type: Date, required: true },
		expiresAt: { type: Date, required: true },
	},
	{ collection: 'user_sessions' }
);

/** Lista as sessões do usuário e acha as excedentes pela mais antiga. */
userSessionSchema.index({ user: 1, lastSeenAt: -1 });
userSessionSchema.index({ user: 1, deviceId: 1 });
/** O Mongo remove a sessão quando o refresh token dela expira. */
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserSessionModel = model<UserSession>(
	'UserSession',
	userSessionSchema
);
