import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import {
	ALLOCATION_BUCKETS,
	ExposurePosition,
	computeBucketExposure,
} from './allocation-exposure';
import { TargetAllocationData } from '../target-allocation.service';

/**
 * Produtor de `portfolio.allocation.breached` (TRA-136, fase 3).
 *
 * Publica o par (meta, real) por balde quando o real passou da meta. E o
 * DADO BRUTO, nao a decisao: nao ha banda de tolerancia, histerese nem
 * comparacao com o estado anterior aqui.
 *
 * TODO(TRA-136 fase 4): o motor de limiares e quem decide o que merece
 * notificacao — banda por politica ("so acima de X pontos percentuais"),
 * comparacao com a leitura anterior (so notificar na TRANSICAO para
 * rompido) e periodicidade. Enquanto ele nao existe, o evento carrega os
 * numeros crus e a moderacao real e a preferencia do usuario, que vem
 * desligada por padrao para `allocationBreached`.
 *
 * Gatilho atual: o momento em que o usuario salva a meta — o unico ponto
 * do servidor em que meta e composicao sao conhecidas juntas hoje. O
 * metodo e publico para que o agendador da fase 4 reaproveite a mesma
 * avaliacao sem duplicar regra.
 */
@Injectable()
export class AllocationBreachProducer {
	private readonly logger = new Logger(AllocationBreachProducer.name);

	constructor(
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	/** Nunca lanca: salvar a meta nao pode falhar porque o Redis caiu. */
	async evaluateForUser(
		userId: string,
		target: TargetAllocationData | null
	): Promise<void> {
		try {
			if (!target) return;
			if (!Types.ObjectId.isValid(userId)) return;

			const metas = ALLOCATION_BUCKETS.filter(
				(bucket) => typeof target[bucket] === 'number'
			);
			if (metas.length === 0) return;

			const positions = await this.loadPositions(userId);
			if (positions.length === 0) return;

			const real = computeBucketExposure(positions);

			for (const bucket of metas) {
				const targetPct = Number(target[bucket]);
				const actualPct = real[bucket];

				// Sem banda: o corte de verdade e da fase 4.
				if (actualPct <= targetPct) continue;

				await this.publisher.publish(
					createDomainEvent({
						type: DOMAIN_EVENT_TYPES.AllocationBreached,
						subject: userId,
						producer: 'server.portfolio.target-allocation',
						payload: {
							bucket,
							targetPct: round2(targetPct),
							actualPct: round2(actualPct),
						},
					})
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao avaliar alocacao do usuario ${userId}: ${message}`
			);
		}
	}

	private async loadPositions(userId: string): Promise<ExposurePosition[]> {
		const portfolios = await this.portfolioModel
			.find({ userId })
			.select('_id')
			.lean<{ _id: Types.ObjectId }[]>();
		if (portfolios.length === 0) return [];

		return this.assetModel
			.find({ portfolioId: { $in: portfolios.map((p) => p._id) } })
			.select('type quantity total price currentPrice')
			.lean<ExposurePosition[]>();
	}
}

/** Duas casas bastam para um percentual exibido; evita 33.33333333333 no e-mail. */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
