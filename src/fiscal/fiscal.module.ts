import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModule } from 'src/ai/ai.module';
import { assetSchema } from 'src/assets/schema/assets.model';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import { FiscalController } from 'src/fiscal/fiscal.controller';
import { tradeSchema } from 'src/fiscal/schema/trade.model';
import { IrReportService } from 'src/fiscal/services/ir-report.service';
import { PortfolioReportService } from 'src/fiscal/services/portfolio-report.service';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { StockModule } from 'src/stocks/stocks.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Trade', schema: tradeSchema },
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
		]),
		AiModule,
		SubscriptionModule,
		StockModule,
	],
	controllers: [FiscalController],
	providers: [
		FiscalService,
		AveragePriceService,
		IrReportService,
		PortfolioReportService,
	],
	exports: [FiscalService],
})
export class FiscalModule {}
