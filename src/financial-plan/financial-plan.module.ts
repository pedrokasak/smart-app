import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FinancialPlanController } from './financial-plan.controller';
import { FinancialPlanService } from './financial-plan.service';
import { financialPlanSchema } from './infrastructure/financial-plan.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'FinancialPlan', schema: financialPlanSchema },
		]),
	],
	controllers: [FinancialPlanController],
	providers: [FinancialPlanService],
})
export class FinancialPlanModule {}
