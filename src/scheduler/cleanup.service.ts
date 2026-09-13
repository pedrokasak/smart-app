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
	// gráficos de período (1M/3M/...) tenham uma curva contínua mesmo em dias
	// sem upload/manual. Sem isto, o histórico só cresce quando o usuário
	// adiciona/atualiza um ativo (addAssetToPortfolio) ou re-upa.
	//
	// Horário e fuso corrigidos em TRA-143. Dois problemas coexistiam:
	//
	// 1. Era o ÚNICO @Cron do projeto sem `timeZone`, enquanto todos os outros
	//    declaram America/Sao_Paulo e não há TZ global. Num servidor UTC,
	//    `30 0 * * *` cai às 21:30 do dia ANTERIOR em São Paulo — e a data do
	//    snapshot (`toISOString`, UTC) ficava um dia à frente do pregão que
	//    ele de fato refletia.
	//
	// 2. Rodava antes do refresh de cotação das 00:00, então usava a cotação
	//    das 18:00 do dia anterior. Às 19:30 o pregão já fechou (incluindo
	//    after-market) e o refresh das 18:00 já gravou o fechamento do dia.
	@Cron('30 19 * * *', {
		name: 'portfolio-daily-snapshot',
		timeZone: 'America/Sao_Paulo',
	})
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
