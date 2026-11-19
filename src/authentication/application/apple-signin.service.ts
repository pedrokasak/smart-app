import {
	Inject,
	Injectable,
	Optional,
	UnauthorizedException,
} from '@nestjs/common';
import {
	SECURITY_AUDIT,
	SecurityAudit,
} from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import { AuthenticationService } from 'src/authentication/authentication.service';
import { AppleSigninDto } from 'src/authentication/dto/apple-signin.dto';
import { UserModel } from 'src/users/schema/user.model';
import {
	APPLE_IDENTITY_VERIFIER,
	AppleIdentity,
	AppleIdentityVerifier,
} from './ports/apple-identity-verifier.port';

/**
 * Login com a Apple. A conta se liga pelo `sub`, porque a Apple pode omitir o
 * e-mail depois do primeiro login. Nome e e-mail do corpo da requisição nunca
 * decidem de quem é a conta: só o token assinado decide.
 */
@Injectable()
export class AppleSigninService {
	constructor(
		@Inject(APPLE_IDENTITY_VERIFIER)
		private readonly verifier: AppleIdentityVerifier,
		private readonly authentication: AuthenticationService,
		@Optional()
		@Inject(SECURITY_AUDIT)
		private readonly securityAudit?: SecurityAudit
	) {}

	async signin(payload: AppleSigninDto) {
		const identity = await this.verifier.verify(
			payload.identityToken,
			payload.nonce
		);
		const user =
			(await this.findBySub(identity.sub)) ??
			(await this.linkByEmail(identity)) ??
			(await this.createAccount(identity, payload));

		return this.authentication.completeSocialLogin(user, {
			keepConnected: payload.keepConnected,
			device: payload.device,
		});
	}

	private findBySub(sub: string) {
		return UserModel.findOne({ appleSub: sub }).select('+password').exec();
	}

	/** Conta já cadastrada com o mesmo e-mail, que a Apple confirma ser da pessoa. */
	private async linkByEmail(identity: AppleIdentity) {
		if (!identity.email || !identity.emailVerified) return null;

		const user = await UserModel.findOne({ email: identity.email })
			.select('+password +appleSub')
			.exec();
		if (!user) return null;

		// Outro Apple ID já está ligado a esta conta: não troca em silêncio.
		if (user.appleSub) {
			throw new UnauthorizedException('Conta Apple inválida');
		}
		// O cadastro por senha não verifica e-mail: quem a pré-registrou perde o
		// acesso antes do vínculo. Com 2FA, não dá para saber quem é quem sem o
		// código, e o vínculo acontece antes dele, então pede o login normal.
		if (!user.isEmailVerified) {
			if (user.twoFactorEnabled) {
				throw new UnauthorizedException(
					'Entre com e-mail e senha para usar esta conta'
				);
			}
			await this.authentication.claimUnverifiedAccount(user);
		}
		// A condição fica no filtro: dois logins simultâneos não podem ambos ligar.
		const linked = await UserModel.updateOne(
			{ _id: user._id, appleSub: { $exists: false } },
			{ $set: { appleSub: identity.sub } }
		).exec();
		if (linked.modifiedCount === 0) {
			throw new UnauthorizedException('Conta Apple inválida');
		}
		this.securityAudit?.emit({
			type: SECURITY_EVENT.SocialAccountLinked,
			actor: { userId: String(user._id) },
			payload: { provider: 'apple' },
		});
		return user;
	}

	private createAccount(identity: AppleIdentity, payload: AppleSigninDto) {
		if (!identity.email || !identity.emailVerified) {
			throw new UnauthorizedException(
				'Conta Apple inválida ou email não verificado'
			);
		}
		return this.authentication.createSocialUser({
			email: identity.email,
			firstName: payload.firstName?.trim() || 'Usuário',
			lastName: payload.lastName?.trim() ?? '',
			appleSub: identity.sub,
		});
	}
}
