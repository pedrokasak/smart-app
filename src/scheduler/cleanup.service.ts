// cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';

@Injectable()
export class CleanupService {
	private readonly logger = new Logger(CleanupService.name);

	constructor(
		private tokenBlacklistService: TokenBlacklistService,
		private readonly portfolioService: PortfolioService
	) {}

	@Cron('0 0 * * *') // Execute every day at midnight
	async handleCron() {
		this.logger.debug('Iniciando limpeza de tokens expirados...');
		await this.tokenBlacklistService.cleanupExpiredTokens();
		this.logger.debug('Tokens expirados removidos da blacklist', {
			timestamp: new Date().toISOString(),
		});
	}

	// Snapshot diário do histórico de TODOS os portfólios, para que os
	// gráficos de período (1M/3M/...) tenham uma curva contínua crescente
	// mesmo em dias sem upload/manual. Sem isto, o histórico só cresce quando
	// o usuário adiciona/atualiza um ativo (addAssetToPortfolio) ou re-upa.
	@Cron('30 0 * * *') // 00:30 diário, após a limpeza de tokens (00:00)
	async recordDailyPortfolioSnapshots() {
		this.logger.debug('Registrando snapshots diários de portfólio...');
		try {
			const portfolioIds = await this.portfolioService.getAllPortfolioIds();
			await Promise.all(
				portfolioIds.map((id) =>
					this.portfolioService
						.recordHistorySnapshot(id)
						.catch((err) =>
							this.logger.error(
								`Falha ao registrar snapshot do portfólio ${id}: ${err?.message}`
							)
						)
				)
			);
			this.logger.debug(`${portfolioIds.length} snapshots registrados.`);
		} catch (err) {
			this.logger.error(`Erro ao registrar snapshots diários: ${err?.message}`);
		}
	}
}
