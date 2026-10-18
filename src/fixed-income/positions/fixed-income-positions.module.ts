import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { MacroIndicatorsModule } from 'src/macro-indicators/macro-indicators.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { FixedIncomeMarkingScheduler } from './application/fixed-income-marking.scheduler';
import { FixedIncomePositionsService } from './application/fixed-income-positions.service';
import {
	FIXED_INCOME_HOLDINGS,
	FIXED_INCOME_INDEX_SERIES,
	FIXED_INCOME_PORTFOLIO_ACCESS,
} from './application/fixed-income-positions.ports';
import { FixedIncomePositionsController } from './fixed-income-positions.controller';
import { MacroIndexSeriesReader } from './infrastructure/macro-index-series.reader';
import { MongoFixedIncomeHoldingsStore } from './infrastructure/mongo-fixed-income-holdings.store';
import { PortfolioAccessAdapter } from './infrastructure/portfolio-access.adapter';

/**
 * Renda fixa como posição da carteira (TRA-230, fase 2). Separado do
 * comparador (`FixedIncomeModule`), que não depende de carteira: este lê a
 * carteira, o comparador não.
 */
@Module({
	imports: [
		MacroIndicatorsModule,
		PortfolioModule,
		MongooseModule.forFeature([{ name: 'Asset', schema: assetSchema }]),
	],
	controllers: [FixedIncomePositionsController],
	providers: [
		FixedIncomePositionsService,
		FixedIncomeMarkingScheduler,
		MacroIndexSeriesReader,
		{ provide: FIXED_INCOME_INDEX_SERIES, useExisting: MacroIndexSeriesReader },
		MongoFixedIncomeHoldingsStore,
		{
			provide: FIXED_INCOME_HOLDINGS,
			useExisting: MongoFixedIncomeHoldingsStore,
		},
		PortfolioAccessAdapter,
		{
			provide: FIXED_INCOME_PORTFOLIO_ACCESS,
			useExisting: PortfolioAccessAdapter,
		},
	],
})
export class FixedIncomePositionsModule {}
