import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MARKET_SOURCE_STORE, MarketSourceStore } from './market-intel.ports';
import { INITIAL_MARKET_SOURCES } from 'src/market-intel/infrastructure/market-sources.seed';

/**
 * Semeia as fontes iniciais de RSS ao iniciar (idempotente via upsert por id).
 */
@Injectable()
export class MarketSourcesSeeder implements OnModuleInit {
	private readonly logger = new Logger(MarketSourcesSeeder.name);

	constructor(
		@Inject(MARKET_SOURCE_STORE) private readonly store: MarketSourceStore
	) {}

	async onModuleInit(): Promise<void> {
		let inserted = 0;
		for (const source of INITIAL_MARKET_SOURCES) {
			try {
				const existing = await this.store.findById(source.id);
				if (!existing) {
					await this.store.save({
						...source,
						lastFetchedAt: null,
						etag: null,
						lastModified: null,
					});
					inserted++;
				}
			} catch (err) {
				this.logger.warn(
					`Seed de fonte [${source.id}] falhou: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		if (inserted > 0) {
			this.logger.log(`Market Intel: ${inserted} fonte(s) semeada(s)`);
		}
	}
}
