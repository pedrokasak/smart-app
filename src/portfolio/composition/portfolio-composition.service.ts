import { Injectable } from '@nestjs/common';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { TargetAllocationService } from 'src/portfolio/target-allocation/target-allocation.service';
import { computeYieldOnCost, type YieldOnCostResult } from './yield-on-cost';
import {
	computeRebalancingGap,
	type RebalancingGapResult,
} from './rebalancing-gap';

/**
 * Composição da carteira: quanto rende sobre o que foi pago, e quão longe está
 * da política-alvo (TRA-141).
 *
 * Rota separada de `/portfolio/returns` de propósito: aquilo é rentabilidade no
 * tempo, isto é retrato da carteira hoje. Juntar faria uma resposta que muda por
 * dois motivos independentes.
 */

export interface PortfolioCompositionOutput {
	yield: YieldOnCostResult;
	rebalancing: RebalancingGapResult;
	/** Por que algum bloco não pôde ser calculado. */
	unavailable: string[];
}

@Injectable()
export class PortfolioCompositionService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly targetAllocationService: TargetAllocationService
	) {}

	async getComposition(userId: string): Promise<PortfolioCompositionOutput> {
		const [portfolios, target] = await Promise.all([
			this.portfolioService.getUserPortfolios(userId),
			// Meta é opcional: quem nunca configurou não tem desvio, e o serviço
			// devolve null em vez de lançar.
			this.targetAllocationService.findByUser(userId).catch(() => null),
		]);

		const assets = (portfolios || []).flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		const yieldResult = computeYieldOnCost(assets);
		const rebalancing = computeRebalancingGap({ positions: assets, target });

		const unavailable: string[] = [];
		if (!rebalancing.hasTarget) {
			unavailable.push('target_allocation_missing');
		}
		// Sem provento registrado o yield não é zero, é desconhecido: o
		// enriquecimento de mercado pode simplesmente não ter rodado ainda.
		if (yieldResult.assets.every((asset) => asset.dividendsPerShare === 0)) {
			unavailable.push('dividend_history_missing');
		}

		return { yield: yieldResult, rebalancing, unavailable };
	}
}
