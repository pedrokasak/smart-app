import { Injectable, Logger } from '@nestjs/common';
import { User } from 'src/users/schema/user.model';
import {
	NotificationChannelName,
	NotificationPayload,
} from '../domain/notification.types';
import {
	NotificationChannel,
	NotificationChannelSendResult,
} from './notification-channel.port';
import { buildTemplate } from './notification-templates';

/**
 * Stub deliberado. A issue TRA-38 pede canal push como interface — o
 * provedor real (FCM/APNs) entra em outro ciclo. Aqui logamos o payload
 * pra permitir testes de integracao de ponta a ponta e ja retornamos
 * sucesso com marca de skipped no service quando o usuario nao ativou o
 * canal.
 *
 * Quando plugar o provedor real:
 *   1. Injetar o SDK (ex: firebase-admin) via port dedicada
 *   2. Ler `user.deviceTokens` (nao existe hoje — adicionar ao schema)
 *   3. Manter esta classe: substituir o corpo do send()
 */
@Injectable()
export class PushNotificationChannel implements NotificationChannel {
	private readonly logger = new Logger(PushNotificationChannel.name);

	name(): NotificationChannelName {
		return NotificationChannelName.Push;
	}

	async send(
		user: User,
		payload: NotificationPayload
	): Promise<NotificationChannelSendResult> {
		const tpl = buildTemplate(payload);
		this.logger.log(
			`[push-stub] user=${user._id?.toString() ?? '?'} type=${payload.type} title="${tpl.title}"`
		);
		// TODO(TRA-XXX): integrar FCM/APNs. Por ora, tratamos como sucesso
		// pra nao poluir o log de erros com um canal que ainda nao existe.
		return { channel: this.name(), success: true };
	}
}
