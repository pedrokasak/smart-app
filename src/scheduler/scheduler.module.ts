import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { CleanupService } from './cleanup.service';

@Module({
	imports: [
		ScheduleModule.forRoot(), // Configura o módulo de agendamento
		TokenBlacklistModule, // Importa o TokenBlacklistModule para injetar o TokenBlacklistService
	],
	providers: [CleanupService],
})
export class SchedulerModule {}
