import { Injectable } from '@nestjs/common';
import { NotificationChannelName } from '../domain/notification.types';
import {
	NotificationChannel,
	NotificationChannelSendResult,
} from './notification-channel.port';

/**
 * Canal push (TRA-136, fase 6) — Web Push / VAPID.
 *
 * ATENCAO: este canal NAO envia nada. Nao e um stub esquecido; e a
 * consequencia de uma decisao de produto: **push e diario e agregado**. O
 * usuario recebe UM aviso por dia ("3 novidades na sua carteira"), nao um
 * por evento.
 *
 * Como isso se encaixa na porta `NotificationChannel`, que e
 * por-notificacao e sincrona:
 *
 *   - o que o canal decide no instante do evento e "esta notificacao entra
 *     no resumo de hoje?" — e isso ele decide de verdade, aplicando as
 *     preferencias por evento do usuario (quem checa e o
 *     `NotificationsService`, antes de chamar `send`);
 *   - o resultado dessa decisao vira `deliveries[push].status = deferred`
 *     no proprio doc auditavel de `Notification`;
 *   - a entrega roda em `DailyPushDigestScheduler`, que le exatamente
 *     esses docs, agrega por usuario e chama a porta `WebPushSender` uma
 *     unica vez.
 *
 * A alternativa era tirar o push da lista de canais e deixar a agregacao
 * ler a colecao por conta propria. Ficaria pior: as preferencias por
 * evento e o registro de auditoria por canal deixariam de valer para push,
 * e o `NotificationChannelName.Push` viraria um enum sem dono. Manter o
 * canal como o ponto que ACEITA (e nao o que entrega) preserva os dois, ao
 * custo de um unico campo opcional na porta.
 *
 * Por isso este arquivo nao tem dependencia nenhuma: aceitar e barato.
 */
@Injectable()
export class PushNotificationChannel implements NotificationChannel {
	name(): NotificationChannelName {
		return NotificationChannelName.Push;
	}

	// Parametros da porta omitidos de proposito: aceitar aqui e so registrar
	// que a notificacao entra no agregado do dia. Quem le usuario e conteudo
	// e o DailyPushDigestScheduler, na hora do envio.
	async send(): Promise<NotificationChannelSendResult> {
		return { channel: this.name(), success: true, deferred: true };
	}
}
