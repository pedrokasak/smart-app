import { Injectable } from '@nestjs/common';
import { SimulateSellUseCase } from 'src/fiscal/tax-engine/application/simulate-sell.use-case';
import {
	SellSimulationInput,
	SellSimulationOutput,
	TaxAssetType,
	TaxEstimateRateConfig,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';

const DEFAULT_TAX_RATES: TaxEstimateRateConfig = {
	stock: 0.15,
	fii: 0.2,
	crypto: 0.15,
	etf: 0.15,
	fund: 0.15,
	other: 0.15,
};

@Injectable()
export class SimulateSaleImpactUseCase {
	constructor(private readonly simulateSellUseCase: SimulateSellUseCase) {}

	execute(input: SellSimulationInput): SellSimulationOutput {
		const simulation = this.simulateSellUseCase.execute({
			symbol: input.symbol,
			assetType: input.assetType,
			quantityToSell: input.quantityToSell,
			sellPrice: input.sellPrice,
			fees: input.fees,
			accumulatedCompensableLoss: input.accumulatedCompensableLoss,
			stockMonthlyGrossSales: input.stockMonthlyGrossSales,
			rulesConfig: input.rulesConfig,
			currentPosition: input.currentPosition,
		});

		const taxRateApplied = this.resolveTaxRate(input.assetType, input.taxRateConfig);
		const estimatedTax =
			simulation.classification === 'isento'
				? 0
				: this.safeMoney(simulation.taxableBaseAfterCompensation * taxRateApplied);

		return {
			symbol: simulation.symbol,
			assetType: simulation.assetType,
			simulatedSellDate: this.toIsoDate(input.simulatedSellDate),
			averagePrice: simulation.averagePriceAtSale,
			realizedPnl: simulation.realizedPnl,
			estimatedTax,
			taxRateApplied,
			taxableBaseAfterCompensation: simulation.taxableBaseAfterCompensation,
			compensationUsed: simulation.compensationUsed,
			classification: simulation.classification,
			monthlyExemptionApplied: simulation.monthlyExemptionApplied,
			remainingQuantity: simulation.remainingPosition.quantity,
			remainingPosition: simulation.remainingPosition,
			assumptions: simulation.assumptions,
		};
	}

	private resolveTaxRate(
		assetType: TaxAssetType,
		override?: Partial<TaxEstimateRateConfig>
	): number {
		const custom = override?.[assetType];
		if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 0) {
			return custom;
		}
		return DEFAULT_TAX_RATES[assetType];
	}

	private toIsoDate(value: Date | string): string | null {
		const parsed = new Date(value);
		const time = parsed.getTime();
		if (!Number.isFinite(time)) return null;
		return parsed.toISOString();
	}

	private safeMoney(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Number(value.toFixed(2));
	}
}

