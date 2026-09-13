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
	PortfolioAssetInput,
	PortfolioIntelligenceService,
} from 'src/portfolio/intelligence/application/portfolio-intelligence.service';

/**
 * Produtor de `portfolio.score.evaluated` (TRA-136, fase 4).
 *
 * Publica a LEITURA do score de diversificacao que o
 * `PortfolioIntelligenceEngine` ja calcula — nao um julgamento. Nao existe
 * "score baixo" absoluto: uma carteira de tres ativos sempre pontua mal, e
 * avisar isso todo dia seria ruido. O que e noticia e a QUEDA contra o
 * proprio historico do usuario, e so o motor de limiares sabe disso, porque
 * so ele guarda a leitura anterior.
 *
 * Nunca lanca: e chamado por cron e por rota; nenhum dos dois pode falhar
 * porque o Redis caiu.
 */
@Injectable()
export class PortfolioScoreProducer {
	private readonly logger = new Logger(PortfolioScoreProducer.name);

	constructor(
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		private readonly intelligence: PortfolioIntelligenceService
	) {}

	async evaluateForUser(userId: string): Promise<void> {
		try {
			if (!Types.ObjectId.isValid(userId)) return;

			const assets = await this.loadAssets(userId);
			// Carteira vazia nao tem score — e nao ter score e diferente de
			// score zero. Publicar zero aqui viraria "queda de 100 pontos" na
			// primeira vez que o usuario esvaziasse a carteira.
			if (assets.length === 0) return;

			const analysis = this.intelligence.analyzeAssets(assets);
			const diversification = analysis.estimates.diversification;

			if (
				!Number.isFinite(diversification.score) ||
				!Number.isFinite(diversification.maxScore)
			) {
				return;
			}

			await this.publisher.publish(
				createDomainEvent({
					type: DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated,
					subject: userId,
					producer: 'server.portfolio.intelligence',
					payload: {
						score: round2(diversification.score),
						maxScore: diversification.maxScore,
					},
				})
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao avaliar score do usuario ${userId}: ${message}`
			);
		}
	}

	private async loadAssets(userId: string): Promise<PortfolioAssetInput[]> {
		const portfolios = await this.portfolioModel
			.find({ userId })
			.select('_id')
			.lean<{ _id: Types.ObjectId }[]>();
		if (portfolios.length === 0) return [];

		const docs = await this.assetModel
			.find({ portfolioId: { $in: portfolios.map((p) => p._id) } })
			.select('symbol type quantity total price currentPrice sector')
			.lean<
				Array<{
					symbol?: string;
					type?: PortfolioAssetInput['type'];
					quantity?: number;
					total?: number;
					price?: number;
					currentPrice?: number;
					sector?: string | null;
				}>
			>();

		return docs.map((doc) => ({
			symbol: String(doc.symbol ?? ''),
			type: doc.type ?? 'other',
			quantity: Number(doc.quantity ?? 0),
			total: typeof doc.total === 'number' ? doc.total : undefined,
			price: typeof doc.price === 'number' ? doc.price : undefined,
			currentPrice:
				typeof doc.currentPrice === 'number' ? doc.currentPrice : undefined,
			sector: doc.sector ?? null,
		}));
	}
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
