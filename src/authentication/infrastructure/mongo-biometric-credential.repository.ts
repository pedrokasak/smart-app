import { Injectable } from '@nestjs/common';
import {
	BiometricCredential,
	BiometricCredentialModel,
} from 'src/authentication/biometric/biometric-credential.model';
import {
	BiometricCredentialRepository,
	StoredBiometricCredential,
} from 'src/authentication/biometric/biometric-credential.repository';

@Injectable()
export class MongoBiometricCredentialRepository implements BiometricCredentialRepository {
	async replaceForDevice({
		userId,
		...credential
	}: StoredBiometricCredential): Promise<void> {
		await BiometricCredentialModel.updateOne(
			{ user: userId, deviceId: credential.deviceId },
			{ $set: credential },
			{ upsert: true }
		).exec();
	}

	async findByHash(
		credentialHash: string
	): Promise<StoredBiometricCredential | null> {
		const document = await BiometricCredentialModel.findOne({ credentialHash })
			.lean<BiometricCredential>()
			.exec();
		if (!document) return null;
		return {
			userId: String(document.user),
			deviceId: document.deviceId,
			credentialHash: document.credentialHash,
			createdAt: document.createdAt,
			lastUsedAt: document.lastUsedAt,
			expiresAt: document.expiresAt,
		};
	}

	async markUsed(
		credentialHash: string,
		lastUsedAt: Date,
		expiresAt: Date
	): Promise<void> {
		await BiometricCredentialModel.updateOne(
			{ credentialHash },
			{ $set: { lastUsedAt, expiresAt } }
		).exec();
	}

	async deleteForDevice(userId: string, deviceId: string): Promise<boolean> {
		const result = await BiometricCredentialModel.deleteOne({
			user: userId,
			deviceId,
		}).exec();
		return result.deletedCount > 0;
	}

	async deleteAllOfUser(userId: string): Promise<void> {
		await BiometricCredentialModel.deleteMany({ user: userId }).exec();
	}
}
