import {
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { jwtSecret } from '../env';
import { TokenBlacklistService } from '../token-blacklist/token-blacklist.service';
import { IS_PUBLIC_KEY } from '../utils/constants';

/** Único `type` de JWT que autoriza uma rota protegida. */
const ACCESS_TOKEN_TYPE = 'access';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
	constructor(
		private jwtService: JwtService,
		private reflector: Reflector,
		private tokenBlacklistService: TokenBlacklistService
	) {
		super();
		if (!this.tokenBlacklistService) {
			throw new Error(
				'TokenBlacklistService não foi injetado corretamente no JwtAuthGuard'
			);
		}
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();

		// Permite acesso público à rota de webhooks do Stripe.
		//
		// Compara o PATH exato, nunca `request.url.includes(...)`: `request.url`
		// carrega a query string, e um `includes` casa em qualquer posição —
		// `GET /portfolio/<id>?x=/webhooks/stripe` pulava o guard inteiro e
		// abria toda rota que não dependesse de `req.user` para quem não tem
		// conta nenhuma (TRA-89).
		if (this.isStripeWebhookPath(request)) {
			return true;
		}

		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		const token = this.extractTokenFromHeader(request);

		if (!token) {
			throw new UnauthorizedException('Token não fornecido.');
		}

		const isBlacklisted = await this.tokenBlacklistService.isBlacklisted(token);
		if (isBlacklisted) {
			console.log('❌ Erro: Token está na blacklist.');
			throw new UnauthorizedException('Token inválido ou expirado.');
		}

		let payload: { type?: string };
		try {
			payload = await this.jwtService.verifyAsync(token, {
				secret: jwtSecret,
			});
		} catch (error) {
			throw new UnauthorizedException('Token inválido ou expirado.');
		}

		// Assinatura válida não basta: `tempToken` de 2FA, refresh token e token
		// de acesso são assinados com o MESMO jwtSecret e só se distinguem pelo
		// claim `type`. Sem esta checagem, o tempToken devolvido pelo /auth/signin
		// a quem apresentou apenas a senha — antes do segundo fator — era aceito
		// como credencial em qualquer rota, e o 2FA deixava de proteger a conta.
		//
		// Falha fechada de propósito: token sem `type` não foi emitido como token
		// de acesso por este servidor. Todos os emissores atuais marcam 'access'
		// (signin, refresh, cadastro e o fluxo de 2FA).
		if (payload?.type !== ACCESS_TOKEN_TYPE) {
			throw new UnauthorizedException('Token inválido ou expirado.');
		}

		request['user'] = payload;

		return true;
	}

	/**
	 * `request.path` já vem sem query string. O fallback corta manualmente
	 * caso o objeto de request não seja o do Express (testes, adapters).
	 * Barra final é tolerada; qualquer outra coisa não é a rota do webhook.
	 */
	private isStripeWebhookPath(request: {
		path?: string;
		url?: string;
	}): boolean {
		const rawPath = request.path ?? String(request.url || '').split('?')[0];
		const normalized = rawPath.replace(/\/+$/, '');
		return normalized === '/webhooks/stripe';
	}

	private extractTokenFromHeader(request: Request): string | undefined {
		// console.log(request.headers['authorization']);
		const [type, token] = request.headers['authorization']?.split(' ') ?? [];
		return type === 'Bearer' ? token : undefined;
	}
}
