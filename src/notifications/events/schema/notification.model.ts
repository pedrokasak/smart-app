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
	},
	{ timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, dedupeKey: 1, createdAt: -1 });

export const NotificationModel = model<Notification>(
	'Notification',
	notificationSchema
);
