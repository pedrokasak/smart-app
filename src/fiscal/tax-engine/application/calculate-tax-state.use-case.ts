import { Injectable } from '@nestjs/common';
import { TaxEngineCalculator } from 'src/fiscal/tax-engine/domain/tax-engine.calculator';
import {
	TaxEngineEvaluationOutput,
	TaxOperationInput,
	TaxEngineRulesConfig,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';

@Injectable()
export class CalculateTaxStateUseCase {
	private readonly calculator = new TaxEngineCalculator();

	execute(
		operations: TaxOperationInput[],
		rulesConfig?: TaxEngineRulesConfig
	): TaxEngineEvaluationOutput {
		return this.calculator.evaluateOperations(operations, rulesConfig);
	}
}
