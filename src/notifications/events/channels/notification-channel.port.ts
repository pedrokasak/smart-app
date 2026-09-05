import { User } from 'src/users/schema/user.model';
import {
	NotificationChannelName,
	NotificationPayload,
} from '../domain/notification.types';

export type NotificationChannelSendResult = {
	channel: NotificationChannelName;
	success: boolean;
	error?: string;
	/**
	 * O canal aceitou a notificacao mas a entrega acontece depois, fora
	 * deste fluxo (TRA-136, fase 6 — push diario agregado).
	 *
	 * Campo OPCIONAL: canal que entrega na hora (e-mail) simplesmente nao
	 * responde nada aqui e continua funcionando como antes. Sem ele o
	 * service so teria "deu certo/deu errado" e gravaria `sent` para algo
	 * que ainda nao saiu.
	 */
	deferred?: boolean;
};

/**
 * Contrato agnostico de canal (Adapter/Strategy). Novo canal (SMS, push
 * real, webhook) implementa esta interface e entra na lista provida em
 * NOTIFICATION_CHANNELS. O NotificationsService itera sem saber quem esta
 * la — Open/Closed principle.
 */
export interface NotificationChannel {
	name(): NotificationChannelName;
	send(
		user: User,
		payload: NotificationPayload
	): Promise<NotificationChannelSendResult>;
}

export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');
