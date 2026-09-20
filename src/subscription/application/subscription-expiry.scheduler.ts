import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WebhooksService } from 'src/subscription/webhooks.service';

/**
 * Faz as assinaturas vencidas virarem `unpaid` de fato (TRA-192).
 *
 * `WebhooksService.checkExpiredSubscriptions` já existia e está correta,
 * mas NINGUÉM a chamava: sem `@Cron`, sem endpoint, sem consumidor. O
 * efeito era acesso pago vitalício — `findCurrentSubscriptionByUser`
 * filtra só por `status: active|trialing` e não olha data nenhuma, então
 * uma concessão de teste com prazo vencido continuava liberando o plano
 * para sempre.
 *
 * O cron das 8h que já existia (`SubscriptionExpiringScheduler`) apenas
 * PUBLICA aviso de "vai vencer" — não altera status. São coisas
 * diferentes e ambas precisam existir.
 *
 * Roda de madrugada, antes do aviso das 8h, para que quem venceu hoje já
 * apareça como vencido quando a notificação do dia for montada.
 *
 * Concessão permanente não é afetada: ela grava `currentPeriodEnd` em
 * 2099-12-31, então nunca entra no filtro de vencidas. Qualquer prazo
 * finito — 14 dias, 6 meses, o que o admin definir — cai naturalmente,
 * porque a regra é a data e não o tipo da concessão.
 */
@Injectable()
export class SubscriptionExpiryScheduler {
	private readonly logger = new Logger(SubscriptionExpiryScheduler.name);

	constructor(private readonly webhooksService: WebhooksService) {}

	@Cron('0 2 * * *', {
		name: 'subscription-expiry',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			await this.webhooksService.checkExpiredSubscriptions();
			this.logger.log('Assinaturas vencidas reavaliadas.');
		} catch (error) {
			// Um dia sem varredura é recuperável na próxima execução; derrubar
			// o processo por causa disso não é.
			this.logger.error(
				`Falha ao reavaliar assinaturas vencidas: ${error?.message}`
			);
		}
	}
}
