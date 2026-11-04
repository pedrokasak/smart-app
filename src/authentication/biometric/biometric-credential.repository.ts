export const BIOMETRIC_CREDENTIAL_REPOSITORY = Symbol(
	'BIOMETRIC_CREDENTIAL_REPOSITORY'
);

export interface StoredBiometricCredential {
	userId: string;
	deviceId: string;
	credentialHash: string;
	createdAt: Date;
	lastUsedAt: Date;
	expiresAt: Date;
}

export interface BiometricCredentialRepository {
	/** Cada aparelho tem uma credencial por conta: cadastrar de novo substitui. */
	replaceForDevice(credential: StoredBiometricCredential): Promise<void>;
	findByHash(credentialHash: string): Promise<StoredBiometricCredential | null>;
	markUsed(
		credentialHash: string,
		lastUsedAt: Date,
		expiresAt: Date
	): Promise<void>;
	deleteForDevice(userId: string, deviceId: string): Promise<boolean>;
	deleteAllOfUser(userId: string): Promise<void>;
}
