import {
	Inject,
	Injectable,
	Optional,
	UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
	SECURITY_AUDIT,
	SecurityAudit,
} from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import {
	AuthenticationService,
	SessionUser,
} from 'src/authentication/authentication.service';
import { hashRefreshToken as digest } from 'src/authentication/security/refresh-token-hash';
import {
	SessionDevice,
	USER_SESSION_CLOCK,
} from 'src/authentication/session/user-session.service';
import { UserModel } from 'src/users/schema/user.model';
import {
	BIOMETRIC_CREDENTIAL_REPOSITORY,
	BiometricCredentialRepository,
} from './biometric-credential.repository';

export const BIOMETRIC_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const INVALID_CREDENTIAL = 'Credencial de biometria inválida';

/**
 * Login por biometria como em banco (ADR-001). O aparelho guarda uma credencial
 * própria, que o sistema só libera depois da biometria. Ela abre uma sessão
 * nova: sair continua encerrando a sessão de verdade no server.
 *
 * Só nasce numa sessão já autenticada, depois da senha e do 2FA, e por isso a
 * entrada com ela não pede 2FA de novo. Tem 256 bits aleatórios, então um
 * digest SHA-256 basta e a busca pelo digest não vaza nada por tempo.
 */
@Injectable()
export class BiometricCredentialService {
	constructor(
		@Inject(BIOMETRIC_CREDENTIAL_REPOSITORY)
		private readonly repository: BiometricCredentialRepository,
		private readonly authentication: AuthenticationService,
		@Inject(USER_SESSION_CLOCK) private readonly clock: () => Date,
		@Optional()
		@Inject(SECURITY_AUDIT)
		private readonly securityAudit?: SecurityAudit
	) {}

	async enroll(userId: string, device: SessionDevice): Promise<string> {
		const credential = crypto.randomBytes(32).toString('base64url');
		const now = this.clock();
		await this.repository.replaceForDevice({
			userId,
			deviceId: device.deviceId,
			credentialHash: digest(credential),
			createdAt: now,
			lastUsedAt: now,
			expiresAt: new Date(now.getTime() + BIOMETRIC_CREDENTIAL_TTL_MS),
		});
		this.securityAudit?.emit({
			type: SECURITY_EVENT.BiometricEnrolled,
			actor: { userId },
			payload: { platform: device.platform },
		});
		return credential;
	}

	async signin(credential: string, device: SessionDevice) {
		const credentialHash = digest(credential);
		const stored = await this.repository.findByHash(credentialHash);
		const now = this.clock();
		if (
			!stored ||
			stored.deviceId !== device.deviceId ||
			stored.expiresAt <= now
		) {
			throw new UnauthorizedException(INVALID_CREDENTIAL);
		}

		const user = await UserModel.findById(stored.userId)
			.select('+password')
			.exec();
		if (!user) throw new UnauthorizedException(INVALID_CREDENTIAL);

		await this.repository.markUsed(
			credentialHash,
			now,
			new Date(now.getTime() + BIOMETRIC_CREDENTIAL_TTL_MS)
		);
		return this.authentication.issueSessionTokens(user as SessionUser, {
			keepConnected: false,
			device,
		});
	}

	async revoke(userId: string, deviceId: string): Promise<void> {
		const deleted = await this.repository.deleteForDevice(userId, deviceId);
		if (deleted) {
			this.securityAudit?.emit({
				type: SECURITY_EVENT.BiometricRevoked,
				actor: { userId },
				payload: { reason: 'user_request' },
			});
		}
	}
}
