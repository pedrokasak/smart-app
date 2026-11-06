import { Module } from '@nestjs/common';
import { FinancialPlanModule } from 'src/financial-plan/financial-plan.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { DividendIncomeService } from './application/dividend-income.service';
import { DividendIncomeController } from './dividend-income.controller';

/**
 * Renda de proventos explicada (RF-8 de docs/requisitos/ia-didatica.md).
 * Lê carteira e plano. O BFF mobile usa o serviço para a tela de proventos.
 */
@Module({
	imports: [PortfolioModule, FinancialPlanModule],
	controllers: [DividendIncomeController],
	providers: [DividendIncomeService],
	exports: [DividendIncomeService],
})
export class DividendIncomeModule {}
