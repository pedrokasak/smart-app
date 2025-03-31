// cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

@Injectable()
export class CleanupService {
	private readonly logger = new Logger(CleanupService.name);

	constructor(private tokenBlacklistService: TokenBlacklistService) {}

	@Cron('0 0 * * *') // Execute every day at midnight
	async handleCron() {
		this.logger.debug('Iniciando limpeza de tokens expirados...');
		await this.tokenBlacklistService.cleanupExpiredTokens();
		this.logger.debug('Tokens expirados removidos da blacklist', {
			timestamp: new Date().toISOString(),
		});
	}
}
