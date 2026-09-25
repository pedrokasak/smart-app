import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { FiscalModule } from 'src/fiscal/fiscal.module';
import { tradeSchema } from 'src/fiscal/schema/trade.model';
import { EmailModule } from 'src/notifications/email/email.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { UsersModule } from 'src/users/users.module';
import { ReportBuilderService } from './application/report-builder.service';
import { ReportDeliveryScheduler } from './application/report-delivery.scheduler';
import { ReportSchedulesService } from './application/report-schedules.service';
import { ReportsService } from './application/reports.service';
import { reportScheduleSchema } from './infrastructure/report-schedule.model';
import { ReportsController } from './reports.controller';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'ReportSchedule', schema: reportScheduleSchema },
			{ name: 'Trade', schema: tradeSchema },
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
		]),
		FiscalModule,
		PortfolioModule,
		EmailModule,
		UsersModule,
		// USER_PLAN_RESOLVER para o envio agendado (TRA-193).
		SubscriptionModule,
	],
	controllers: [ReportsController],
	providers: [
		ReportBuilderService,
		ReportsService,
		ReportSchedulesService,
		ReportDeliveryScheduler,
	],
})
export class ReportsModule {}
