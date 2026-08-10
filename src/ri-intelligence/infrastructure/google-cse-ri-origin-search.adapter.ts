import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { RiOriginSearchPort } from 'src/ri-intelligence/application/ri-origin-search.port';
import { googleCseApiKey, googleCseEngineId } from 'src/env';

@Injectable()
export class GoogleCseRiOriginSearchAdapter implements RiOriginSearchPort {
	private readonly logger = new Logger(GoogleCseRiOriginSearchAdapter.name);
	private readonly cache = new Map<string, { expiresAt: number; origin: string | null }>();
	private readonly ttlMs = 24 * 60 * 60 * 1000;

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
