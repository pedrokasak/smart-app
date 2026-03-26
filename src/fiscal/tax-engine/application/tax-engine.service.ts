import { Injectable } from '@nestjs/common';
import { CalculateTaxStateUseCase } from 'src/fiscal/tax-engine/application/calculate-tax-state.use-case';
import { SimulateSaleImpactUseCase } from 'src/fiscal/tax-engine/application/simulate-sale-impact.use-case';
import { SimulateSellUseCase } from 'src/fiscal/tax-engine/application/simulate-sell.use-case';
import {
	SellSimulationInput,
	SellSimulationOutput,
	TaxEngineEvaluationOutput,
	TaxEngineRulesConfig,
	TaxOperationInput,
	TaxSellSimulationInput,
	TaxSellSimulationOutput,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';

@Injectable()
export class TaxEngineService {
	constructor(
		private readonly calculateTaxStateUseCase: CalculateTaxStateUseCase,
		private readonly simulateSellUseCase: SimulateSellUseCase,
		private readonly simulateSaleImpactUseCase: SimulateSaleImpactUseCase
	) {}

	evaluateOperations(
		operations: TaxOperationInput[],
		rulesConfig?: TaxEngineRulesConfig
	): TaxEngineEvaluationOutput {
		return this.calculateTaxStateUseCase.execute(operations, rulesConfig);
	}

	simulateSell(input: TaxSellSimulationInput): TaxSellSimulationOutput {
		return this.simulateSellUseCase.execute(input);
	}

	simulateSaleImpact(input: SellSimulationInput): SellSimulationOutput {
		return this.simulateSaleImpactUseCase.execute(input);
	}
}
