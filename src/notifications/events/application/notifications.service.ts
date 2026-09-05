import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import {
	DEDUPE_WINDOW_HOURS,
	DEFAULT_EMAIL_PREFS,
	DEFAULT_PUSH_PREFS,
	NotificationChannelName,
	NotificationDeliveryStatus,
	NotificationPayload,
	NotificationType,
} from '../domain/notification.types';
import { Notification } from '../schema/notification.model';
import {
	NOTIFICATION_CHANNELS,
	NotificationChannel,
} from '../channels/notification-channel.port';

export type NotifyInput = {
	userId: string | Types.ObjectId;
	payload: NotificationPayload;
	/**
	 * Opcional. Quando presente, o service ignora um novo disparo do mesmo
	 * (user, type, dedupeKey) dentro da janela DEDUPE_WINDOW_HOURS. Sem
	 * dedupeKey, cada notify() e uma entrada nova.
	 */
	dedupeKey?: string;
	/**
	 * Opcional. Restringe fanout a um subconjunto de canais. Default: todos
	 * os canais habilitados via preferencias do usuario.
	 */
	channels?: NotificationChannelName[];
};

export type NotifyResult = {
	notificationId?: string;
	dedupedFrom?: string; // id do doc anterior que causou o skip
	deliveries: {
		channel: NotificationChannelName;
		status: NotificationDeliveryStatus;
		error?: string;
	}[];
};

/**
 * Servico central de notificacoes. Faz tres coisas e so tres:
 *   1. Checar preferencias do usuario por tipo/canal
 *   2. Deduplicar por janela quando `dedupeKey` for informado
 *   3. Persistir o doc auditavel e disparar via cada canal
 *
 * Nao decide *quando* notificar — quem chama (cron, event listener, use
 * case) e o produtor. Isso mantem o service livre de acoplamento com
 * dominios especificos (assinatura, portfolio, IA).
 */
@Injectable()
export class NotificationsService {
	private readonly logger = new Logger(NotificationsService.name);

	constructor(
		@InjectModel('Notification')
		private readonly notificationModel: Model<Notification>,
		@InjectModel('User')
		private readonly userModel: Model<User>,
		@Inject(NOTIFICATION_CHANNELS)
		private readonly channels: NotificationChannel[]
	) {}

	async notify(input: NotifyInput): Promise<NotifyResult> {
		const userId =
			typeof input.userId === 'string'
				? new Types.ObjectId(input.userId)
				: input.userId;

		const user = await this.userModel.findById(userId).lean<User | null>();
		if (!user) {
			this.logger.warn(
				`notify() chamado para usuario inexistente: ${userId.toString()}`
			);
			return { deliveries: [] };
		}

		if (input.dedupeKey) {
			const dupe = await this.findDuplicate(
				userId,
				input.payload.type,
				input.dedupeKey
			);
			if (dupe) {
				return {
					dedupedFrom: dupe._id?.toString(),
					deliveries: dupe.deliveries.map((d) => ({
						channel: d.channel,
						status: d.status,
						error: d.error,
					})),
				};
			}
		}

		const allowedChannels = input.channels ? new Set(input.channels) : null;

		const deliveries: NotifyResult['deliveries'] = [];
		for (const channel of this.channels) {
			if (allowedChannels && !allowedChannels.has(channel.name())) {
				continue;
			}

			if (!this.userAllows(user, input.payload.type, channel.name())) {
				deliveries.push({
					channel: channel.name(),
					status: NotificationDeliveryStatus.Skipped,
				});
				continue;
			}

			try {
				const result = await channel.send(user, input.payload);
				deliveries.push({
					channel: channel.name(),
					status: result.success
						? NotificationDeliveryStatus.Sent
						: NotificationDeliveryStatus.Failed,
					error: result.error,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.logger.error(`Canal ${channel.name()} lancou excecao: ${message}`);
				deliveries.push({
					channel: channel.name(),
					status: NotificationDeliveryStatus.Failed,
					error: message,
				});
			}
		}

		const now = new Date();
		const created = await this.notificationModel.create({
			user: userId,
			type: input.payload.type,
			payload: input.payload,
			dedupeKey: input.dedupeKey,
			deliveries: deliveries.map((d) => ({
				channel: d.channel,
				status: d.status,
				error: d.error,
				sentAt: d.status === NotificationDeliveryStatus.Sent ? now : undefined,
			})),
		});

		return {
			notificationId: created._id?.toString(),
			deliveries,
		};
	}

	async listForUser(
		userId: string | Types.ObjectId,
		limit = 50
	): Promise<Notification[]> {
		const id = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
		return this.notificationModel
			.find({ user: id })
			.sort({ createdAt: -1 })
			.limit(Math.min(Math.max(1, limit), 200))
			.lean<Notification[]>();
	}

	/**
	 * Publica: usada por schedulers/eventos e tambem exposta pro admin
	 * conferir preferencia efetiva ao investigar suporte.
	 */
	userAllows(
		user: User,
		type: NotificationType,
		channel: NotificationChannelName
	): boolean {
		const prefs = user.notificationPreferences ?? {};
		const channelPrefs = (prefs as Record<string, unknown>)[channel] as
			| Record<string, boolean>
			| undefined;
		const value = channelPrefs?.[type];
		if (typeof value === 'boolean') return value;
		return channel === NotificationChannelName.Email
			? DEFAULT_EMAIL_PREFS[type]
			: DEFAULT_PUSH_PREFS[type];
	}

	private async findDuplicate(
		userId: Types.ObjectId,
		type: NotificationType,
		dedupeKey: string
	): Promise<Notification | null> {
		const windowStart = new Date(
			Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000
		);
		return this.notificationModel
			.findOne({
				user: userId,
				type,
				dedupeKey,
				createdAt: { $gte: windowStart },
			})
			.sort({ createdAt: -1 })
			.lean<Notification | null>();
	}
}
