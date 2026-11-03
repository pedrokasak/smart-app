import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
} from '@nestjs/common';
import { MARKET_SOURCE_STORE, MarketSourceStore } from './market-intel.ports';
import { INITIAL_MARKET_SOURCES } from 'src/market-intel/infrastructure/market-sources.seed';

/**
 * Semeia as fontes iniciais de RSS ao iniciar (idempotente via upsert por id).
 *
 * Roda em `onApplicationBootstrap` porque os models estáticos só conectam no
 * `onModuleInit` do `DatabaseService`. Em `onModuleInit`, cada fonte podia
 * esperar 10 s de buffering do Mongoose antes da conexão existir, e o boot
 * passava do limite do health check.
 */
@Injectable()
export class MarketSourcesSeeder implements OnApplicationBootstrap {
	private readonly logger = new Logger(MarketSourcesSeeder.name);

	constructor(
		@Inject(MARKET_SOURCE_STORE) private readonly store: MarketSourceStore
	) {}

	async onApplicationBootstrap(): Promise<void> {
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
