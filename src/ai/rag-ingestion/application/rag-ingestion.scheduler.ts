import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import {
	planAtLeast,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import { RagFactBuilderService } from 'src/ai/rag-ingestion/application/rag-fact-builder.service';
import {
	RAG_INGESTION,
	RagIngestionPort,
} from 'src/ai/rag-ingestion/application/rag-ingestion.port';

/**
 * Ingestão diária dos fatos de carteira no RAG (TRA-84).
 *
 * Roda 03:00 (America/Sao_Paulo), fora do horário de uso. Dado defasado em
 * até 24h é aceitável pro caso de uso de chat, e ingestão por evento custa
 * infra que não se paga agora.
 *
 * Só usuários Pro+ (plano da assinatura, TRA-79). Rodar embedding pra Free,
 * que não tem acesso ao chat de RAG, é custo puro. A ingestão é incremental
 * por content_hash no trackerr-ia (TRA-74), então usuário cuja carteira não
 * mudou custa quase nada — só a comparação de hash.
 *
 * Falha por usuário isolada com allSettled: o embedding de um não pode
 * derrubar a varredura inteira.
 */
@Injectable()
export class RagIngestionScheduler {
	private readonly logger = new Logger(RagIngestionScheduler.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		private readonly portfolioService: PortfolioService,
		private readonly factBuilder: RagFactBuilderService,
		@Inject(RAG_INGESTION) private readonly ingestion: RagIngestionPort,
		@Inject(USER_PLAN_RESOLVER)
		private readonly userPlanResolver: UserPlanResolverPort
	) {}

	@Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
	async ingestDaily(): Promise<void> {
		const users = await this.userModel.find({}, { _id: 1 });
		this.logger.log(`Ingestão de RAG: avaliando ${users.length} usuário(s).`);

		let ingested = 0;
		const results = await Promise.allSettled(
			users.map((user) => this.ingestForUser(String((user as any)._id)))
		);
		for (const r of results) {
			if (r.status === 'fulfilled' && r.value) ingested++;
		}

		const failures = results.filter((r) => r.status === 'rejected').length;
		this.logger.log(
			`Ingestão de RAG: ${ingested} usuário(s) ingerido(s), ${failures} falha(s) isolada(s).`
		);
	}

	/** Retorna true se ingeriu (usuário Pro+ com carteira). Público pra teste. */
	async ingestForUser(userId: string): Promise<boolean> {
		const plan = await this.userPlanResolver.resolve(userId);
		if (!planAtLeast(plan, 'pro')) return false;

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const positions = this.toPositions(portfolios);
		if (!positions.length) return false;

		const asOf = new Date().toISOString().slice(0, 10);
		const items = this.factBuilder.build(positions, asOf);
		if (!items.length) return false;

		const result = await this.ingestion.ingest(userId, items);
		if (!result.ingested) {
			this.logger.warn(
				`Ingestão falhou para usuário ${userId}: ${result.failureReason}`
			);
			return false;
		}
		return true;
	}

	private toPositions(portfolios: unknown[]): PortfolioIntelligencePosition[] {
		const assets = (portfolios as Array<{ assets?: unknown[] }>).flatMap(
			(portfolio) => (Array.isArray(portfolio?.assets) ? portfolio.assets : [])
		);
		return (assets as Array<Record<string, unknown>>)
			.map((asset) => ({
				symbol: String(asset?.symbol || asset?.ticker || asset?.code || '')
					.trim()
					.toUpperCase(),
				assetType: (asset?.type ||
					'other') as PortfolioIntelligencePosition['assetType'],
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
			}))
			.filter((position) => !!position.symbol);
	}
}
