import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
	resolveAutoIndex,
	resolveIndexBuildDelayMs,
} from './mongo-index-policy';

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

	constructor(@InjectConnection() private readonly connection: Connection) {}

	onApplicationBootstrap() {
		if (process.env.NODE_ENV === 'test' || resolveAutoIndex()) return;

		const delayMs = resolveIndexBuildDelayMs();
		setTimeout(() => void this.ensureIndexes(), delayMs).unref();
		this.logger.log(`[indexes] criação agendada para daqui ${delayMs}ms`);
	}

	async ensureIndexes(): Promise<IndexBuildResult> {
		const result: IndexBuildResult = { built: [], failed: [] };
		for (const name of this.connection.modelNames()) {
			try {
				await this.connection.model(name).createIndexes();
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
