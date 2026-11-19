import {
	Inject,
	Injectable,
	Logger,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import {
	AppleIdentity,
	AppleIdentityVerifier,
} from 'src/authentication/application/ports/apple-identity-verifier.port';

export const APPLE_AUDIENCES = Symbol('APPLE_AUDIENCES');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const KEYS_TIMEOUT_MS = 3000;
/** As chaves mudam raramente; além disso, `kid` novo força uma busca. */
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
/** Token com `kid` inventado não pode virar uma busca na Apple por requisição. */
const KEYS_MIN_REFRESH_INTERVAL_MS = 60 * 1000;

type AppleClaims = {
	sub?: string;
	email?: string;
	email_verified?: boolean | string;
	nonce?: string;
};

@Injectable()
export class AppleIdentityVerifierAdapter implements AppleIdentityVerifier {
	private readonly logger = new Logger(AppleIdentityVerifierAdapter.name);
	private keys = new Map<string, string>();
	private keysFetchedAt = 0;
	private refreshing: Promise<void> | null = null;

	constructor(
		private readonly jwtService: JwtService,
		@Inject(APPLE_AUDIENCES) private readonly audiences: string[]
	) {}

	async verify(identityToken: string, nonce?: string): Promise<AppleIdentity> {
		// Sem audiência configurada, qualquer app da Apple passaria. Falha fechada.
		if (this.audiences.length === 0) {
			throw new UnauthorizedException('Login com a Apple indisponível');
		}

		const publicKey = await this.publicKeyFor(this.keyIdOf(identityToken));
		const claims = this.verifySignature(identityToken, publicKey);

		if (!claims.sub) {
			throw new UnauthorizedException('Token da Apple inválido');
		}
		// Também recusa o nonce omitido: quem reenvia um token capturado não pode
		// pular a checagem deixando de mandar o campo.
		if (claims.nonce !== nonce) {
			throw new UnauthorizedException('Token da Apple inválido');
		}

		return {
			sub: claims.sub,
			email: claims.email?.trim().toLowerCase() || undefined,
			// A Apple envia ora booleano, ora texto.
			emailVerified: String(claims.email_verified).toLowerCase() === 'true',
		};
	}

	private keyIdOf(identityToken: string): string {
		const decoded = this.jwtService.decode(identityToken, {
			complete: true,
		}) as { header?: { kid?: string } } | null;
		const kid = decoded?.header?.kid;
		if (!kid) {
			throw new UnauthorizedException('Token da Apple inválido');
		}
		return kid;
	}

	private verifySignature(
		identityToken: string,
		publicKey: string
	): AppleClaims {
		try {
			return this.jwtService.verify<AppleClaims>(identityToken, {
				publicKey,
				// Fixo: aceitar o `alg` do próprio token permite assinar com HS256
				// usando a chave pública como segredo.
				algorithms: ['RS256'],
				issuer: APPLE_ISSUER,
				audience: this.audiences as [string, ...string[]],
			});
		} catch {
			throw new UnauthorizedException('Token da Apple inválido');
		}
	}

	private async publicKeyFor(kid: string): Promise<string> {
		const now = Date.now();
		const stale = now - this.keysFetchedAt > KEYS_TTL_MS;
		const canRefresh = now - this.keysFetchedAt > KEYS_MIN_REFRESH_INTERVAL_MS;

		if (stale || (!this.keys.has(kid) && canRefresh)) {
			// Logins simultâneos dividem uma busca só.
			this.refreshing ??= this.refreshKeys(now).finally(() => {
				this.refreshing = null;
			});
			await this.refreshing;
		}

		const key = this.keys.get(kid);
		if (!key) {
			throw new UnauthorizedException('Token da Apple inválido');
		}
		return key;
	}

	private async refreshKeys(now: number): Promise<void> {
		try {
			const response = await fetch(APPLE_KEYS_URL, {
				signal: AbortSignal.timeout(KEYS_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const { keys } = (await response.json()) as {
				keys: (crypto.JsonWebKey & { kid: string })[];
			};
			this.keys = new Map(
				keys.map((jwk) => [
					jwk.kid,
					crypto
						.createPublicKey({ key: jwk, format: 'jwk' })
						.export({ type: 'spki', format: 'pem' })
						.toString(),
				])
			);
			this.keysFetchedAt = now;
		} catch (error) {
			this.logger.error(
				`Falha ao buscar as chaves da Apple: ${(error as Error)?.message}`
			);
			// Com chaves ainda em cache, a falha não derruba quem já tem chave boa.
			if (this.keys.size === 0) {
				throw new ServiceUnavailableException(
					'Login com a Apple indisponível no momento'
				);
			}
			// Tenta de novo depois do intervalo mínimo, não só em 24 horas.
			this.keysFetchedAt = now - KEYS_TTL_MS + KEYS_MIN_REFRESH_INTERVAL_MS;
		}
	}
}
