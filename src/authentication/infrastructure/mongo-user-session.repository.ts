import { Injectable } from '@nestjs/common';
import {
	UserSession,
	UserSessionModel,
} from 'src/authentication/session/user-session.model';
import {
	NewUserSession,
	RotationUpdate,
	StoredUserSession,
	UserSessionRepository,
} from 'src/authentication/session/user-session.repository';

function toStored(document: UserSession): StoredUserSession {
	return {
		sid: document.sid,
		userId: String(document.user),
		deviceId: document.deviceId ?? null,
		deviceName: document.deviceName ?? null,
		platform: document.platform,
		refreshTokenHash: document.refreshTokenHash,
		previousRefreshTokenHash: document.previousRefreshTokenHash ?? null,
		rotatedAt: document.rotatedAt ?? null,
		recoverableUntil: document.recoverableUntil ?? null,
		lastSeenAt: document.lastSeenAt,
		createdAt: document.createdAt,
		expiresAt: document.expiresAt,
	};
}

@Injectable()
export class MongoUserSessionRepository implements UserSessionRepository {
	async create({ userId, ...session }: NewUserSession): Promise<void> {
		await UserSessionModel.create({ ...session, user: userId });
	}

	async find(sid: string, userId: string): Promise<StoredUserSession | null> {
		const document = await UserSessionModel.findOne({ sid, user: userId })
			.lean<UserSession>()
			.exec();
		return document ? toStored(document) : null;
	}

	async listByUser(userId: string): Promise<StoredUserSession[]> {
		const documents = await UserSessionModel.find({ user: userId })
			.sort({ lastSeenAt: -1 })
			.lean<UserSession[]>()
			.exec();
		return documents.map(toStored);
	}

	async swapRefreshToken(
		sid: string,
		expectedHash: string,
		update: RotationUpdate
	): Promise<boolean> {
		const result = await UserSessionModel.updateOne(
			{ sid, refreshTokenHash: expectedHash },
			{ $set: update }
		).exec();
		return result.modifiedCount > 0;
	}

	async deleteOne(sid: string, userId: string): Promise<boolean> {
		const result = await UserSessionModel.deleteOne({
			sid,
			user: userId,
		}).exec();
		return result.deletedCount > 0;
	}

	async deleteOtherSessionsOfDevice(
		userId: string,
		deviceId: string,
		keepSid: string
	): Promise<void> {
		await UserSessionModel.deleteMany({
			user: userId,
			deviceId,
			sid: { $ne: keepSid },
		}).exec();
	}

	async deleteAllOfUser(userId: string): Promise<void> {
		await UserSessionModel.deleteMany({ user: userId }).exec();
	}

	async deleteBeyondNewest(userId: string, keep: number): Promise<void> {
		const excess = await UserSessionModel.find({ user: userId })
			.sort({ lastSeenAt: -1 })
			.skip(keep)
			.select('_id')
			.lean()
			.exec();
		if (excess.length === 0) return;
		await UserSessionModel.deleteMany({
			_id: { $in: excess.map(({ _id }) => _id) },
		}).exec();
	}
}
