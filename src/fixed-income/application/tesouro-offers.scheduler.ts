import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TesouroOffersService } from './tesouro-offers.service';

/**
 * Leitura das taxas do Tesouro Direto (TRA-269).
 *
 * 10h40 e 18h40 de Brasília: o arquivo do Tesouro Transparente é regravado no
 * fim da manhã, e a segunda passada cobre um atraso de publicação. Idempotente
 * — grava sempre o mesmo documento —, então roda em mais de uma instância sem
 * duplicar nada. Uma falha fica no log e a tela segue com o último pregão.
 */
@Injectable()
export class TesouroOffersScheduler {
	private readonly logger = new Logger(TesouroOffersScheduler.name);

	constructor(private readonly offers: TesouroOffersService) {}

	@Cron('40 10,18 * * *', {
		name: 'tesouro-offers-refresh',
		timeZone: 'America/Sao_Paulo',
	})
	async run(): Promise<void> {
		try {
			const stored = await this.offers.refresh();
			this.logger.log(
				`Tesouro Direto atualizado: ${stored.titles.length} título(s), pregão de ${stored.baseDate}`
			);
		} catch (error) {
			this.logger.error(
				`Atualização do Tesouro Direto falhou: ${(error as Error)?.message || error}`
			);
		}
	}
}
