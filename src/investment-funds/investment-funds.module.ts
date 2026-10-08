import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { InvestmentFundIngestionService } from './application/investment-fund-ingestion.service';
import { InvestmentFundsScheduler } from './application/investment-funds.scheduler';
import { InvestmentFundsService } from './application/investment-funds.service';
import {
	FUND_HOLDING_PRICE_WRITER,
	INVESTMENT_FUND_SOURCE,
	INVESTMENT_FUND_STORE,
} from './application/ports/investment-funds.ports';
import { CvmInvestmentFundSource } from './infrastructure/cvm-investment-fund.source';
import {
	InvestmentFundClassModel,
	InvestmentFundIngestionModel,
	InvestmentFundQuoteModel,
} from './infrastructure/investment-fund.models';
import { MongoFundHoldingPriceWriter } from './infrastructure/mongo-fund-holding-price.writer';
import { MongoInvestmentFundStore } from './infrastructure/mongo-investment-fund.store';
import { InvestmentFundsController } from './investment-funds.controller';

/**
 * Fundos de investimento com dado oficial da CVM (TRA-276).
 *
 * Exporta `InvestmentFundsService` para a carteira marcar posições
 * `investment_fund` a mercado; não depende de nenhum módulo de negócio. O
 * `ScheduleModule.forRoot()` já é registrado pelo SchedulerModule.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'InvestmentFundClass', schema: InvestmentFundClassModel.schema },
			{ name: 'InvestmentFundQuote', schema: InvestmentFundQuoteModel.schema },
			{
				name: 'InvestmentFundIngestion',
				schema: InvestmentFundIngestionModel.schema,
			},
			{ name: 'Asset', schema: assetSchema },
		]),
	],
	controllers: [InvestmentFundsController],
	providers: [
		CvmInvestmentFundSource,
		{ provide: INVESTMENT_FUND_SOURCE, useExisting: CvmInvestmentFundSource },
		MongoInvestmentFundStore,
		{ provide: INVESTMENT_FUND_STORE, useExisting: MongoInvestmentFundStore },
		MongoFundHoldingPriceWriter,
		{
			provide: FUND_HOLDING_PRICE_WRITER,
			useExisting: MongoFundHoldingPriceWriter,
		},
		InvestmentFundIngestionService,
		InvestmentFundsScheduler,
		InvestmentFundsService,
	],
	exports: [InvestmentFundsService],
})
export class InvestmentFundsModule {}
