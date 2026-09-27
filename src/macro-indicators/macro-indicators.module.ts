import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
	MACRO_SERIES_REPOSITORY,
	MACRO_SERIES_SOURCE,
} from './application/macro-series.ports';
import { MacroSeriesScheduler } from './application/macro-series.scheduler';
import { MacroSeriesService } from './application/macro-series.service';
import { BcbSgsSource } from './infrastructure/bcb-sgs.source';
import { MacroSeriesPointModel } from './infrastructure/macro-series-point.model';
import { MongoMacroSeriesRepository } from './infrastructure/mongo-macro-series.repository';
import { MacroIndicatorsController } from './macro-indicators.controller';

/**
 * Indicadores macro do BACEN (TRA-227): catálogo de séries, espelho local no
 * Mongo, sincronização diária e leitura com procedência.
 *
 * Não depende de nenhum módulo de negócio — `portfolio` depende dele, nunca o
 * contrário. O `ScheduleModule.forRoot()` já é registrado pelo SchedulerModule.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'MacroSeriesPoint', schema: MacroSeriesPointModel.schema },
		]),
	],
	controllers: [MacroIndicatorsController],
	providers: [
		MongoMacroSeriesRepository,
		{
			provide: MACRO_SERIES_REPOSITORY,
			useExisting: MongoMacroSeriesRepository,
		},
		BcbSgsSource,
		{ provide: MACRO_SERIES_SOURCE, useExisting: BcbSgsSource },
		MacroSeriesService,
		MacroSeriesScheduler,
	],
	exports: [MacroSeriesService],
})
export class MacroIndicatorsModule {}
