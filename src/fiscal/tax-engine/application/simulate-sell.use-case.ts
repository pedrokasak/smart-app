import { Injectable } from '@nestjs/common';
import { TaxEngineCalculator } from 'src/fiscal/tax-engine/domain/tax-engine.calculator';
import {
	TaxSellSimulationInput,
	TaxSellSimulationOutput,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';

@Injectable()
export class SimulateSellUseCase {
	private readonly calculator = new TaxEngineCalculator();

	execute(input: TaxSellSimulationInput): TaxSellSimulationOutput {
		return this.calculator.simulateSell(input);
	}
}
