import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { RiOriginSearchPort } from 'src/ri-intelligence/application/ri-origin-search.port';
import { googleCseApiKey, googleCseEngineId } from 'src/env';

/**
 * Hosts de agregadores/portais financeiros conhecidos por aparecerem como
 * resultado orgânico top para buscas de "{empresa} relações com
 * investidores" sem serem o domínio oficial do emissor. Tratar o top-1 como
 * "não encontrado" quando cair aqui é mais seguro do que rastrear o site
 * errado e apresentar conteúdo de terceiros como documento oficial do
 * emissor — nesse caso a descoberta degrada para CVM-only.
 */
const DENYLISTED_ORIGIN_HOSTS: ReadonlySet<string> = new Set([
	'statusinvest.com.br',
	'infomoney.com.br',
	'fundamentei.com',
	'investing.com',
	'b3.com.br',
	'money.cnn.com',
	'google.com',
	'investidor10.com.br',
	'suno.com.br',
	'oceans14.com.br',
	'guiainvest.com.br',
	'meusdividendos.com',
	'tradingview.com',
	'einvestidor.estadao.com.br',
	'valor.globo.com',
	'exame.com',
	'bloomberg.com',
	'reuters.com',
	'wikipedia.org',
	'linkedin.com',
	'youtube.com',
]);

@Injectable()
export class GoogleCseRiOriginSearchAdapter implements RiOriginSearchPort {
	private readonly logger = new Logger(GoogleCseRiOriginSearchAdapter.name);
	private readonly cache = new Map<string, { expiresAt: number; origin: string | null }>();
	private readonly ttlMs = 24 * 60 * 60 * 1000;

	private isDenylistedHost(hostname: string): boolean {
		const normalized = hostname.toLowerCase();
		for (const denied of DENYLISTED_ORIGIN_HOSTS) {
			if (normalized === denied || normalized.endsWith(`.${denied}`)) return true;
		}
		return false;
	}

	constructor(
		private readonly httpService: HttpService,
		@Optional() private readonly apiKey: string | undefined = googleCseApiKey,
		@Optional() private readonly engineId: string | undefined = googleCseEngineId
	) {}

	async searchOfficialOrigin(companyName: string): Promise<string | null> {
		if (!this.apiKey || !this.engineId) {
			this.logger.warn(
				'GOOGLE_CSE_API_KEY/GOOGLE_CSE_ENGINE_ID não configurados; pulando busca de origem RI'
			);
			return null;
		}

		const normalizedName = String(companyName || '').trim();
		if (!normalizedName) return null;

		const now = Date.now();
		const cached = this.cache.get(normalizedName);
		if (cached && cached.expiresAt > now) return cached.origin;

		try {
			const query = `${normalizedName} relações com investidores site:.com.br`;
			const response = await firstValueFrom(
				this.httpService.get('https://www.googleapis.com/customsearch/v1', {
					params: {
						key: this.apiKey,
						cx: this.engineId,
						q: query,
						num: 1,
					},
					timeout: 8000,
				})
			);
			const firstLink: string | undefined = response.data?.items?.[0]?.link;
			if (!firstLink) {
				this.cache.set(normalizedName, { expiresAt: now + this.ttlMs, origin: null });
				return null;
			}
			const url = new URL(firstLink);
			if (this.isDenylistedHost(url.hostname)) {
				this.logger.debug(
					`Top resultado do CSE para "${normalizedName}" é um agregador conhecido (${url.hostname}); tratando como não encontrado`
				);
				this.cache.set(normalizedName, { expiresAt: now + this.ttlMs, origin: null });
				return null;
			}
			const origin = `${url.protocol}//${url.host}`;
			this.cache.set(normalizedName, { expiresAt: now + this.ttlMs, origin });
			return origin;
		} catch (error) {
			this.logger.warn(
				`Falha na busca Google CSE para "${normalizedName}": ${error?.message || error}`
			);
			return null;
		}
	}
}
