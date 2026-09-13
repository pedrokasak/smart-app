import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import {
	MARKET_DATA_PROVIDER,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { toDisplaySector } from './sector';

/**
 * Backfill diário do setor dos ativos (TRA-144).
 *
 * ## Por que um job, e não só o enriquecimento
 *
 * `enrichAsset` só roda quando um ativo é adicionado. Ativo que já existia
 * nunca é re-enriquecido, então preencher o setor "de passagem" nunca
 * alcançaria a base existente.
 *
 * ## Três escolhas de desenho
 *
 * **Por símbolo distinto.** Dez usuários com PETR4 compartilham uma consulta
 * e um `updateMany`, em vez de dez consultas iguais.
 *
 * **Lote limitado.** A fonte é rate-limited; o job preenche no máximo
 * `BATCH_SIZE` símbolos por execução e continua no dia seguinte.
 *
 * **Rotação diária do lote.** Símbolos cuja fonte nunca tem setor ficariam
 * `null` para sempre e, sem rotação, ocupariam as primeiras vagas todos os
 * dias — travando os demais. O início do lote avança com o dia.
 *
 * Idempotente: só toca ativo com `sector` nulo, e nunca sobrescreve.
 */

const SECTOR_APPLICABLE_TYPES = ['stock', 'fii'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SectorBackfillResult {
	/** Símbolos com setor pendente na base inteira. */
	pending: number;
	/** Símbolos consultados nesta execução. */
	attempted: number;
	/** Símbolos para os quais a fonte trouxe setor válido. */
	filled: number;
	/** Documentos de ativo atualizados. */
	updatedAssets: number;
}

@Injectable()
export class SectorBackfillScheduler {
	private readonly logger = new Logger(SectorBackfillScheduler.name);

	static readonly BATCH_SIZE = 25;

	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	// 05:00 em São Paulo: depois do investor-profile (04:00), que passa a ler o
	// setor para `distinctSectorCount`, e longe do snapshot das 19:30.
	@Cron('0 5 * * *', {
		name: 'asset-sector-backfill',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const result = await this.backfill();
			this.logger.log(
				`Backfill de setor: ${result.filled}/${result.attempted} símbolo(s) preenchido(s), ${result.updatedAssets} ativo(s) atualizado(s), ${result.pending} pendente(s).`
			);
		} catch (error: any) {
			// Um dia sem backfill é melhor que um cron morto.
			this.logger.error(
				`Backfill de setor falhou: ${error?.message || 'unknown_error'}`
			);
		}
	}

	async backfill(
		limit: number = SectorBackfillScheduler.BATCH_SIZE,
		now: Date = new Date()
	): Promise<SectorBackfillResult> {
		const pendingFilter = {
			// `null` casa com campo nulo E ausente — os ativos antigos nem têm o
			// campo.
			sector: null,
			type: { $in: SECTOR_APPLICABLE_TYPES },
		};

		const symbols: string[] = (
			await this.assetModel.distinct('symbol', pendingFilter)
		)
			.map((symbol) => String(symbol))
			.sort();

		if (!symbols.length) {
			return { pending: 0, attempted: 0, filled: 0, updatedAssets: 0 };
		}

		const batch = rotateBatch(symbols, limit, now);

		let filled = 0;
		let updatedAssets = 0;

		for (const symbol of batch) {
			let rawSector: string | null = null;
			try {
				const snapshot = await this.marketData.getAssetSnapshot(symbol);
				rawSector = snapshot?.sector ?? null;
			} catch (error: any) {
				this.logger.warn(
					`Setor de ${symbol} indisponível: ${error?.message || 'unknown_error'}`
				);
				continue;
			}

			const sector = toDisplaySector(rawSector);
			if (!sector) continue;

			const result = await this.assetModel.updateMany(
				{ ...pendingFilter, symbol },
				{ $set: { sector } }
			);
			filled += 1;
			updatedAssets += Number(result?.modifiedCount || 0);
		}

		return {
			pending: symbols.length,
			attempted: batch.length,
			filled,
			updatedAssets,
		};
	}
}

/**
 * Janela de `limit` símbolos que avança um lote por dia, dando a volta na
 * lista. Determinística: o mesmo dia sempre produz o mesmo lote.
 */
export function rotateBatch(
	symbols: string[],
	limit: number,
	now: Date
): string[] {
	if (symbols.length <= limit) return [...symbols];
	const day = Math.floor(now.getTime() / MS_PER_DAY);
	const start = (day * limit) % symbols.length;
	const batch: string[] = [];
	for (let i = 0; i < limit; i += 1) {
		batch.push(symbols[(start + i) % symbols.length]);
	}
	return batch;
}
