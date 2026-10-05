import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { FixedIncomeComparisonService } from './application/fixed-income-comparison.service';
import { FixedIncomeRatesService } from './application/fixed-income-rates.service';
import { FixedIncomeVerdictService } from './application/fixed-income-verdict.service';
import {
	TESOURO_OFFERS_SOURCE,
	TESOURO_OFFERS_STORE,
} from './application/ports/tesouro-offers.ports';
import { VERDICT_NARRATOR } from './application/ports/verdict-narrator.port';
import { TesouroOffersScheduler } from './application/tesouro-offers.scheduler';
import { TesouroOffersService } from './application/tesouro-offers.service';
import { FixedIncomeController } from './fixed-income.controller';
import { MongoTesouroOffersStore } from './infrastructure/mongo-tesouro-offers.store';
import { TesouroOffersSnapshotModel } from './infrastructure/tesouro-offers-snapshot.model';
import { TesouroTransparenteCsvSource } from './infrastructure/tesouro-transparente-csv.source';
import { TrackerrIaVerdictNarratorAdapter } from './infrastructure/trackerr-ia-verdict-narrator.adapter';

/**
 * Comparador de renda fixa (TRA-269): taxas do BACEN (via macro-indicators) e
 * do Tesouro Direto (Tesouro Transparente), cálculo de retorno líquido e real,
 * e veredito escrito pelo trackerr-ia com validação.
 *
 * Só lê de `macro-indicators`; nenhum módulo de negócio depende deste. O
 * `ScheduleModule.forRoot()` já é registrado pelo SchedulerModule.
 */
@Module({
	imports: [
		HttpModule,
		MacroIndicatorsModule,
		MongooseModule.forFeature([
			{
				name: 'TesouroOffersSnapshot',
				schema: TesouroOffersSnapshotModel.schema,
			},
		]),
	],
	controllers: [FixedIncomeController],
	providers: [
		MongoTesouroOffersStore,
		{ provide: TESOURO_OFFERS_STORE, useExisting: MongoTesouroOffersStore },
		TesouroTransparenteCsvSource,
		{
			provide: TESOURO_OFFERS_SOURCE,
			useExisting: TesouroTransparenteCsvSource,
		},
		TesouroOffersService,
		TesouroOffersScheduler,
		FixedIncomeRatesService,
		FixedIncomeComparisonService,
		TrackerrIaVerdictNarratorAdapter,
		{
			provide: VERDICT_NARRATOR,
			useExisting: TrackerrIaVerdictNarratorAdapter,
		},
		FixedIncomeVerdictService,
	],
})
export class FixedIncomeModule {}
