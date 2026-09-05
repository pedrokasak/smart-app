import { Schema, Types, model } from 'mongoose';
import {
	NotificationChannelName,
	NotificationDeliveryStatus,
	NotificationType,
} from '../domain/notification.types';

/**
 * Doc auditavel de cada notificacao disparada.
 *
 * `dedupeKey` e opcional: quando presente, garante idempotencia (mesmo
 * usuario + tipo + dedupeKey nao dispara duas vezes na janela definida em
 * DEDUPE_WINDOW_HOURS). A checagem e feita no service — o unique index
 * seria estrito demais (queremos permitir repetir depois da janela).
 */
export interface NotificationDeliveryRecord {
	channel: NotificationChannelName;
	status: NotificationDeliveryStatus;
	error?: string;
	sentAt?: Date;
}

export interface Notification extends Document {
	_id?: Types.ObjectId;
	user: Types.ObjectId;
	type: NotificationType;
	payload: Record<string, unknown>;
	dedupeKey?: string;
	deliveries: NotificationDeliveryRecord[];
	/**
	 * Marcada quando o usuario le a notificacao no centro in-app (TRA-136).
	 * Ausente/null = nao lida. Campo aditivo: docs antigos continuam validos
	 * e sao tratados como nao lidos.
	 */
	readAt?: Date | null;
	/**
	 * Resumo em linguagem natural produzido pelo trackerr-ia (TRA-136, fase
	 * 5). Aditivo e sempre opcional: a copy deterministica de
	 * `buildTemplate` continua sendo a fonte de `title`/`body`, e um doc sem
	 * este campo (legado, IA fora do ar, ou tipo que nao enriquece) e
	 * exibido exatamente como antes.
	 */
	aiSummary?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const deliverySchema = new Schema<NotificationDeliveryRecord>(
	{
		channel: {
			type: String,
			enum: Object.values(NotificationChannelName),
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(NotificationDeliveryStatus),
			required: true,
		},
		error: String,
		sentAt: Date,
	},
	{ _id: false }
);

const notificationSchema = new Schema<Notification>(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		type: {
			type: String,
			enum: Object.values(NotificationType),
			required: true,
			index: true,
		},
		payload: {
			type: Schema.Types.Mixed,
			required: true,
		},
		dedupeKey: {
			type: String,
			index: true,
		},
		deliveries: {
			type: [deliverySchema],
			default: [],
		},
		readAt: {
			type: Date,
			default: null,
		},
		aiSummary: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, dedupeKey: 1, createdAt: -1 });
/**
 * Serve as duas consultas do centro in-app (TRA-136) com um indice so:
 *   - contagem de nao lidas: prefixo (user, readAt) por igualdade
 *   - listagem com unreadOnly: mesmo prefixo + createdAt para range do
 *     cursor e ordenacao ja na ordem do indice
 * A listagem sem filtro continua usando { user: 1, createdAt: -1 }.
 */
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

export const NotificationModel = model<Notification>(
	'Notification',
	notificationSchema
);
