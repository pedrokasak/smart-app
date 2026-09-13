import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { digestTokenSecret } from 'src/env';

const TOKEN_PURPOSE = 'portfolio_digest_unsubscribe';
// Link de unsubscribe precisa continuar funcionando em e-mails antigos
// parados na caixa de entrada por meses.
const TOKEN_EXPIRES_IN = '180d';

/**
 * Assina/valida o token de unsubscribe do digest com um secret PRÓPRIO
 * (DIGEST_TOKEN_SECRET), não o JWT_SECRET de autenticação — um token de
 * unsubscribe é matematicamente incapaz de validar como access token,
 * mesmo que alguém tente reaproveitá-lo em outra rota. `purpose` no
 * payload é defesa em profundidade, não a garantia principal.
 */
@Injectable()
export class DigestUnsubscribeTokenService {
	constructor(private readonly jwtService: JwtService) {}

	sign(userId: string): string {
		return this.jwtService.sign(
			{ userId, purpose: TOKEN_PURPOSE },
			{ secret: digestTokenSecret, expiresIn: TOKEN_EXPIRES_IN }
		);
	}

	verify(token: string): { userId: string } | null {
		try {
			const payload = this.jwtService.verify<{
				userId: string;
				purpose: string;
			}>(token, { secret: digestTokenSecret });
			if (payload.purpose !== TOKEN_PURPOSE || !payload.userId) return null;
			return { userId: payload.userId };
		} catch {
			return null;
		}
	}
}
