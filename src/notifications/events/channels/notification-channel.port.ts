import { User } from 'src/users/schema/user.model';
import {
	NotificationChannelName,
	NotificationPayload,
} from '../domain/notification.types';

export type NotificationChannelSendResult = {
	channel: NotificationChannelName;
	success: boolean;
	error?: string;
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
