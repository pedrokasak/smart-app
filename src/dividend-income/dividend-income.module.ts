import { Module } from '@nestjs/common';
import { FinancialPlanModule } from 'src/financial-plan/financial-plan.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { DividendIncomeService } from './application/dividend-income.service';
import { DividendIncomeController } from './dividend-income.controller';

/**
 * Renda de proventos explicada (RF-8 de docs/requisitos/ia-didatica.md).
 * Lê carteira e plano; nenhum módulo depende deste.
 */
@Module({
	imports: [PortfolioModule, FinancialPlanModule],
	controllers: [DividendIncomeController],
	providers: [DividendIncomeService],
})
export class DividendIncomeModule {}
