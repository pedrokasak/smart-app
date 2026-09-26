import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
	Optional,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection, Model } from 'mongoose';
import {
	resolveAutoIndex,
	resolveIndexBuildDelayMs,
} from './mongo-index-policy';

export const DEFAULT_MONGOOSE_CONNECTION = Symbol(
	'DEFAULT_MONGOOSE_CONNECTION'
);

export interface IndexBuildResult {
	built: string[];
	failed: string[];
}

/**
 * Cria os índices declarados nos schemas quando `autoIndex` está desligado:
 * depois do boot e um model por vez, para não repetir o pico que o
 * `autoIndex` causa. `createIndexes()` não remove nada e é no-op para
 * índice que já existe.
 */
@Injectable()
export class IndexMaintenanceService implements OnApplicationBootstrap {
	private readonly logger = new Logger(IndexMaintenanceService.name);

	private readonly defaultConnection: Connection;

	constructor(
		@InjectConnection() private readonly connection: Connection,
		// Models estáticos vivem na conexão global do mongoose, não na do Nest.
		@Optional()
		@Inject(DEFAULT_MONGOOSE_CONNECTION)
		defaultConnection?: Connection
	) {
		this.defaultConnection = defaultConnection ?? mongoose.connection;
	}

	onApplicationBootstrap() {
		if (process.env.NODE_ENV === 'test' || resolveAutoIndex()) return;

		const delayMs = resolveIndexBuildDelayMs();
		setTimeout(() => void this.ensureIndexes(), delayMs).unref();
		this.logger.log(`[indexes] criação agendada para daqui ${delayMs}ms`);
	}

	/** Um model por coleção, somando as duas conexões. */
	private allModels(): Array<[string, Model<any>]> {
		const seen = new Set<string>();
		const models: Array<[string, Model<any>]> = [];
		for (const connection of [this.connection, this.defaultConnection]) {
			for (const name of connection.modelNames()) {
				const model = connection.model(name);
				const key = model.collection.collectionName;
				if (seen.has(key)) continue;
				seen.add(key);
				models.push([name, model]);
			}
		}
		return models;
	}

	async ensureIndexes(): Promise<IndexBuildResult> {
		const result: IndexBuildResult = { built: [], failed: [] };
		for (const [name, model] of this.allModels()) {
			try {
				await model.createIndexes();
				result.built.push(name);
			} catch (error) {
				result.failed.push(name);
				this.logger.error(
					`[indexes] ${name}: falhou — ${(error as Error)?.message}`
				);
			}
		}
		this.logger.log(
			`[indexes] ${result.built.length} models ok, ${result.failed.length} com falha`
		);
		return result;
	}
}
