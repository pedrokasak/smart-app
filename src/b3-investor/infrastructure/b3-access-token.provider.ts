import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import type { B3InvestorConfig } from './b3-investor.config';
import type { B3HttpTransport } from './b3-http.transport';

interface TokenResponse {
	access_token?: string;
	expires_in?: number | string;
}

interface CachedToken {
	value: string;
	expiresAt: number;
}

/** Renova antes de expirar para não mandar token vencido no meio de um lote. */
const RENEW_BEFORE_MS = 60_000;
/** A B3 documenta 3599s; usado só se a resposta vier sem `expires_in`. */
const FALLBACK_TTL_SECONDS = 3599;

/**
 * Token OAuth2 client_credentials da B3 (emitido pelo Azure AD), com cache
 * em memória e uma única requisição em voo por vez.
 */
export class B3AccessTokenProvider {
	private cached: CachedToken | null = null;
	private inflight: Promise<string> | null = null;

	constructor(
		private readonly transport: B3HttpTransport,
		private readonly config: Pick<
			B3InvestorConfig,
			'tokenUrl' | 'clientId' | 'clientSecret' | 'scope'
		>,
		private readonly now: () => number = Date.now
	) {}

	async getToken(): Promise<string> {
		if (this.cached && this.cached.expiresAt - RENEW_BEFORE_MS > this.now()) {
			return this.cached.value;
		}
		if (!this.inflight) {
			this.inflight = this.fetchToken().finally(() => {
				this.inflight = null;
			});
		}
		return this.inflight;
	}

	/** Descarta o token atual (ex.: depois de um 401). */
	invalidate(): void {
		this.cached = null;
	}

	private async fetchToken(): Promise<string> {
		const body = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			scope: this.config.scope,
		}).toString();

		let response;
		try {
			response = await this.transport.send({
				method: 'POST',
				url: this.config.tokenUrl,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			});
		} catch (error) {
			throw new B3InvestorError(
				'unavailable',
				`Falha de rede ao pedir token da B3: ${(error as Error)?.message ?? error}`
			);
		}

		const data = response.data as TokenResponse | undefined;
		if (response.status !== 200 || !data?.access_token) {
			// O corpo de erro do Azure AD pode ecoar o client_id; não vai pro log.
			throw new B3InvestorError(
				'auth_failed',
				`Token da B3 recusado (HTTP ${response.status})`,
				response.status
			);
		}

		const ttlSeconds = Number(data.expires_in) || FALLBACK_TTL_SECONDS;
		this.cached = {
			value: data.access_token,
			expiresAt: this.now() + ttlSeconds * 1000,
		};
		return this.cached.value;
	}
}
