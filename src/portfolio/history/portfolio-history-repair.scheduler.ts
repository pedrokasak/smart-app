import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';
import { rotateBatch } from 'src/portfolio/sector/sector-backfill.scheduler';
import { PortfolioHistoryBackfillService } from './portfolio-history-backfill.service';

export interface HistoryRepairResult {
	/** Carteiras com ao menos um ponto gravado a custo. */
	pending: number;
	attempted: number;
	/** Pontos a custo trocados por valor com fechamento. */
	replaced: number;
	failed: number;
}

/**
 * Corrige o histórico reconstruído a custo (TRA-279).
 *
 * A reconstrução roda uma vez, logo depois da importação. Se naquele momento
 * não havia fechamento histórico, cada dia foi gravado pelo custo e marcado
 * `stale`, e nada voltava a olhar para ele. Este job dá a nova chance quando
 * os fechamentos passam a existir (a ingestão do COTAHIST roda às 22h).
 *
 * Lote rotativo, como o backfill de setor: carteira sem negociação nunca sai
 * da lista (não há como reconstruir) e, sem rotação, travaria as demais.
 * Idempotente: só troca ponto a custo, nunca snapshot com cotação.
 */
@Injectable()
export class PortfolioHistoryRepairScheduler {
	private readonly logger = new Logger(PortfolioHistoryRepairScheduler.name);

	static readonly BATCH_SIZE = 20;

	constructor(
		@InjectModel('PortfolioHistory')
		private readonly historyModel: Model<PortfolioHistory>,
		private readonly backfill: PortfolioHistoryBackfillService
	) {}

	// 05:30 em São Paulo: depois da ingestão de fechamentos (22h, dias úteis) e
	// do backfill de setor (05:00), longe do snapshot das 19:30.
	@Cron('30 5 * * *', {
		name: 'portfolio-history-repair',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const result = await this.repair();
			this.logger.log(
				`Reparo do histórico: ${result.replaced} ponto(s) corrigido(s) em ${result.attempted} de ${result.pending} carteira(s) pendente(s), ${result.failed} falha(s).`
			);
		} catch (error: any) {
			this.logger.error(
				`Reparo do histórico falhou: ${error?.message || 'unknown_error'}`
			);
		}
	}

	async repair(
		limit: number = PortfolioHistoryRepairScheduler.BATCH_SIZE,
		now: Date = new Date()
	): Promise<HistoryRepairResult> {
		const owners: { _id: unknown; userId: unknown }[] =
			await this.historyModel.aggregate([
				{
					$match: {
						$or: [{ stale: true }, { investedValue: { $exists: false } }],
					},
				},
				{ $group: { _id: '$portfolioId', userId: { $first: '$userId' } } },
			]);

		const userByPortfolio = new Map(
			owners.map((row) => [String(row._id), String(row.userId)])
		);
		const portfolioIds = Array.from(userByPortfolio.keys()).sort();
		if (!portfolioIds.length) {
			return { pending: 0, attempted: 0, replaced: 0, failed: 0 };
		}

		const batch = rotateBatch(portfolioIds, limit, now);
		let replaced = 0;
		let failed = 0;

		// Sequencial de propósito: cada carteira busca fechamentos de até 40
		// símbolos, e a fonte é rate-limited.
		for (const portfolioId of batch) {
			try {
				const result = await this.backfill.backfill({
					userId: userByPortfolio.get(portfolioId) as string,
					portfolioId,
				});
				replaced += result.replaced;
			} catch (error: any) {
				failed += 1;
				this.logger.warn(
					`Reparo do histórico da carteira ${portfolioId} falhou: ${error?.message || 'unknown_error'}`
				);
			}
		}

		return {
			pending: portfolioIds.length,
			attempted: batch.length,
			replaced,
			failed,
		};
	}
}
