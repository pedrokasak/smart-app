import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { CleanupService } from './cleanup.service';

@Module({
	imports: [
		ScheduleModule.forRoot(), // Configura o módulo de agendamento
		TokenBlacklistModule, // Importa o TokenBlacklistModule para injetar o TokenBlacklistService
		PortfolioModule, // Para o snapshot diário de histórico de portfólio
	],
	providers: [CleanupService],
})
export class SchedulerModule {}
