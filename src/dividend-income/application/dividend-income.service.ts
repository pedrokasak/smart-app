import { Injectable, Logger } from '@nestjs/common';
import type { DidacticLevel } from 'src/ai/didactic/didactic.types';
import { FinancialPlanService } from 'src/financial-plan/financial-plan.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import {
	type DividendIncomeFacts,
	type IncomeGoalPlan,
	analyzeDividendIncome,
} from '../domain/dividend-income';
import { explainDividendIncome } from './dividend-income-didactic';

export interface DividendIncomeInsight {
	facts: DividendIncomeFacts;
	didactic: ReturnType<typeof explainDividendIncome>;
}

/**
 * Fatos e explicação da renda de proventos de quem pede. As carteiras vêm
 * sempre de `getUserPortfolios(userId)`: o `portfolioId` só filtra entre as
 * da própria pessoa, nunca abre carteira de outro usuário.
 */
@Injectable()
export class DividendIncomeService {
	private readonly logger = new Logger(DividendIncomeService.name);

	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly financialPlanService: FinancialPlanService
	) {}

	async insight(
		userId: string,
		options: { portfolioId?: string; level?: DidacticLevel } = {}
	): Promise<DividendIncomeInsight> {
		const [portfolios, plan] = await Promise.all([
			this.portfolioService.getUserPortfolios(userId),
			this.loadPlan(userId),
		]);
		const selected = (portfolios || []).filter(
			(portfolio: any) =>
				!options.portfolioId ||
				String(portfolio?._id ?? portfolio?.id) === options.portfolioId
		);
		const assets = selected.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		const facts = analyzeDividendIncome(assets, plan);
		return {
			facts,
			didactic: explainDividendIncome(facts, options.level ?? 'intermediario'),
		};
	}

	/** Plano é opcional: sem ele (ou com erro), o bloco sai sem a meta. */
	private async loadPlan(userId: string): Promise<IncomeGoalPlan | null> {
		try {
			const plan = await this.financialPlanService.get(userId);
			const goal = plan.goals.find((item) => item.kind === 'independence');
			return {
				expectedRealReturnPct: plan.expectedRealReturnPct,
				monthlyContribution: plan.monthlyContribution,
				goal: goal
					? { title: goal.title, targetAmount: goal.targetAmount }
					: null,
			};
		} catch (error) {
			this.logger.warn(
				`plano financeiro indisponível para ${userId}: ${(error as Error)?.message || error}`
			);
			return null;
		}
	}
}
