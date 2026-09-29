import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';
import { RiWatchService } from './ri-watch.service';

/**
 * Relogio do vigia de RI (TRA-240).
 *
 * A fonte de hoje, o dataset IPE da CVM, e SEMANAL (o arquivo muda aos
 * domingos, ~07h), entao a varredura quase sempre rele o mesmo arquivo — que
 * o adapter guarda por 6h, e custa um download de ~2 MB. Rodar tres vezes ao
 * dia serve a outra coisa: a das 12h pega o arquivo de domingo mesmo quando
 * a das 7h chega antes da CVM publicar, e cada rodada da nova chance ao que
 * falhou por motivo passageiro (rede, IA fora do ar). Quando entrar uma fonte
 * diaria (consulta do ENET), a cadencia ja serve para ela.
 *
 * A varredura vem antes do processamento, mas uma falha nela nao impede
 * processar o que ja estava pendente de rodadas anteriores.
 */
@Injectable()
export class RiWatchScheduler {
	private readonly logger = new Logger(RiWatchScheduler.name);
	private running = false;

	constructor(
		private readonly watch: RiWatchService,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig
	) {}

	@Cron('0 7,12,18 * * *', {
		name: 'ri-watch',
		timeZone: 'America/Sao_Paulo',
	})
	async run(): Promise<void> {
		if (!this.config.enabled) return;
		// Um resumo pode levar dezenas de segundos; uma rodada longa nao pode
		// ser atropelada pela seguinte.
		if (this.running) {
			this.logger.warn('Vigia de RI: rodada anterior ainda em andamento');
			return;
		}

		this.running = true;
		try {
			try {
				const scan = await this.watch.scan();
				this.logger.log(
					`Vigia de RI: ${scan.registered} documento(s) novo(s) em ` +
						`${scan.tickers} ticker(s) (${scan.failedTickers} com falha)`
				);
			} catch (err) {
				this.logger.error(
					`Vigia de RI: varredura falhou: ${this.messageOf(err)}`
				);
			}

			try {
				const processed = await this.watch.processPending();
				this.logger.log(
					`Vigia de RI: ${processed.summarized} resumido(s), ` +
						`${processed.skipped} ignorado(s), ${processed.failed} com falha`
				);
			} catch (err) {
				this.logger.error(
					`Vigia de RI: processamento falhou: ${this.messageOf(err)}`
				);
			}
		} finally {
			this.running = false;
		}
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
