import { Injectable } from '@nestjs/common';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';
import { TaxAssetType } from 'src/fiscal/tax-engine/domain/tax-engine.types';

export interface TradeDecisionInput {
	symbol: string;
	assetType: TaxAssetType;
	quantityToSell: number;
	sellPrice: number;
	simulatedSellDate: string;
	currentPosition: {
		quantity: number;
		totalCost: number;
	};
	totalPortfolioValue: number;
	accumulatedCompensableLoss?: number;
	stockMonthlyGrossSales?: number;
}

export interface TradeDecisionOutput {
	status: 'ok' | 'degraded';
	preTrade: {
		estimatedTax: number;
		taxRateApplied: number;
		classification: string;
		alternatives: Array<{
			id: 'sell_less' | 'compensate_loss' | 'suggested_order';
			title: string;
			description: string;
		}>;
		explanation: string;
	};
	postTrade: {
		estimatedDarf: number;
		remainingQuantity: number;
		portfolioImpactPercent: number;
		explanation: string;
	};
	warnings: string[];
}

@Injectable()
export class TradeDecisionService {
	constructor(private readonly taxEngineService: TaxEngineService) {}

	buildPreAndPostTrade(input: TradeDecisionInput): TradeDecisionOutput {
		const warnings: string[] = [];
		if (input.quantityToSell <= 0 || input.sellPrice <= 0) {
			return {
				status: 'degraded',
				preTrade: {
					estimatedTax: 0,
					taxRateApplied: 0,
					classification: 'indisponivel',
					alternatives: [],
					explanation:
						'Não foi possível simular pré-trade por falta de quantidade ou preço válidos.',
				},
				postTrade: {
					estimatedDarf: 0,
					remainingQuantity: Number(input.currentPosition?.quantity || 0),
					portfolioImpactPercent: 0,
					explanation:
						'Não foi possível estimar impacto pós-trade com os dados informados.',
				},
				warnings: ['trade_decision_invalid_inputs'],
			};
		}

		const sellImpact = this.taxEngineService.simulateSaleImpact({
			symbol: input.symbol,
			assetType: input.assetType,
			quantityToSell: input.quantityToSell,
			sellPrice: input.sellPrice,
			simulatedSellDate: input.simulatedSellDate,
			currentPosition: input.currentPosition,
			accumulatedCompensableLoss: input.accumulatedCompensableLoss,
			stockMonthlyGrossSales: input.stockMonthlyGrossSales,
		});

		const grossProceeds = Number(input.quantityToSell || 0) * Number(input.sellPrice || 0);
		const portfolioImpactPercent =
			input.totalPortfolioValue > 0
				? Number((-(grossProceeds / input.totalPortfolioValue) * 100).toFixed(2))
				: 0;
		if (input.totalPortfolioValue <= 0) {
			warnings.push('trade_decision_portfolio_value_unavailable');
		}

		const halfQuantity = Number((input.quantityToSell * 0.5).toFixed(8));
		const alternatives: TradeDecisionOutput['preTrade']['alternatives'] = [
			{
				id: 'sell_less',
				title: 'Vender menos agora',
				description: `Simular venda parcial (${halfQuantity}) para reduzir DARF no curto prazo.`,
			},
			{
				id: 'compensate_loss',
				title: 'Compensar com prejuízo acumulado',
				description:
					sellImpact.compensationUsed > 0
						? `Compensação estimada aplicada: R$ ${sellImpact.compensationUsed.toFixed(2)}.`
						: 'Verificar prejuízos compensáveis para reduzir base tributável da operação.',
			},
			{
				id: 'suggested_order',
				title: 'Ordem sugerida de execução',
				description:
					sellImpact.estimatedTax > 0
						? 'Executar venda parcial primeiro e reavaliar imposto antes de zerar posição.'
						: 'Venda atual tende a manter impacto fiscal baixo com os dados disponíveis.',
			},
		];

		const status: TradeDecisionOutput['status'] =
			sellImpact.taxRateApplied > 0 || sellImpact.realizedPnl !== 0 ? 'ok' : 'degraded';
		if (status === 'degraded') {
			warnings.push('trade_decision_partial_estimation');
		}

		return {
			status,
			preTrade: {
				estimatedTax: sellImpact.estimatedTax,
				taxRateApplied: sellImpact.taxRateApplied,
				classification: sellImpact.classification,
				alternatives,
				explanation:
					sellImpact.monthlyExemptionApplied
						? 'Pré-trade: a simulação indica isenção mensal aplicável para a venda atual.'
						: 'Pré-trade: imposto estimado calculado com engine fiscal determinística.',
			},
			postTrade: {
				estimatedDarf: sellImpact.estimatedTax,
				remainingQuantity: sellImpact.remainingQuantity,
				portfolioImpactPercent,
				explanation:
					sellImpact.remainingQuantity <= 0
						? 'Pós-trade: posição será encerrada se a ordem for executada integralmente.'
						: 'Pós-trade: posição permanece aberta após a venda simulada.',
			},
			warnings,
		};
	}
}
