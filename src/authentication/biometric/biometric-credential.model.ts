import { Schema, Types, model } from 'mongoose';

/**
 * Credencial do login por biometria em UM aparelho. Não é uma sessão: sair da
 * conta encerra a sessão e mantém esta credencial. Guarda só o digest.
 */
export interface BiometricCredential {
	_id?: Types.ObjectId;
	user: Types.ObjectId;
	deviceId: string;
	credentialHash: string;
	createdAt: Date;
	lastUsedAt: Date;
	expiresAt: Date;
}

const biometricCredentialSchema = new Schema<BiometricCredential>(
	{
		user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		deviceId: { type: String, required: true },
		credentialHash: { type: String, required: true, unique: true },
		createdAt: { type: Date, required: true },
		lastUsedAt: { type: Date, required: true },
		expiresAt: { type: Date, required: true },
	},
	{ collection: 'biometric_credentials' }
);

biometricCredentialSchema.index({ user: 1, deviceId: 1 }, { unique: true });
/** O Mongo remove a credencial quando ela expira. */
biometricCredentialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const BiometricCredentialModel = model<BiometricCredential>(
	'BiometricCredential',
	biometricCredentialSchema
);
