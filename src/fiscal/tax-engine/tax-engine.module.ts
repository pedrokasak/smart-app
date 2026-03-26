import { Module } from '@nestjs/common';
import { CalculateTaxStateUseCase } from 'src/fiscal/tax-engine/application/calculate-tax-state.use-case';
import { SimulateSaleImpactUseCase } from 'src/fiscal/tax-engine/application/simulate-sale-impact.use-case';
import { SimulateSellUseCase } from 'src/fiscal/tax-engine/application/simulate-sell.use-case';
import { TaxEngineService } from 'src/fiscal/tax-engine/application/tax-engine.service';

@Module({
	providers: [
		CalculateTaxStateUseCase,
		SimulateSellUseCase,
		SimulateSaleImpactUseCase,
		TaxEngineService,
	],
	exports: [
		CalculateTaxStateUseCase,
		SimulateSellUseCase,
		SimulateSaleImpactUseCase,
		TaxEngineService,
	],
})
export class TaxEngineModule {}
