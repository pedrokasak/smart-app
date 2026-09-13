import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Notification } from '../schema/notification.model';
import { IN_APP_NOTIFICATION_TYPES } from '../domain/in-app-notification.types';
import { NotificationCursor } from '../application/notification-cursor';

export type ListInAppParams = {
	userId: Types.ObjectId;
	limit: number;
	cursor: NotificationCursor | null;
	unreadOnly: boolean;
};

/**
 * Unico lugar do modulo que fala Mongo para o centro in-app.
 *
 * Regra inegociavel: TODA consulta daqui carrega `user` no filtro. O escopo
 * por dono nunca depende de quem chama — nao existe metodo que aceite so um
 * `_id`. E por isso que `markAsRead`/`findOwned` recebem os dois ids.
 */
@Injectable()
export class InAppNotificationsRepository {
	constructor(
		@InjectModel('Notification')
		private readonly notificationModel: Model<Notification>
	) {}

	/**
	 * Busca `limit + 1` docs de proposito: o extra so responde "existe proxima
	 * pagina?" e e descartado antes de virar resposta.
	 */
	async list(params: ListInAppParams): Promise<Notification[]> {
		const filter = this.baseFilter(params.userId);

		if (params.unreadOnly) {
			filter.readAt = null;
		}

		if (params.cursor) {
			filter.$or = [
				{ createdAt: { $lt: params.cursor.createdAt } },
				{
					createdAt: params.cursor.createdAt,
					_id: { $lt: params.cursor.id },
				},
			];
		}

		return this.notificationModel
			.find(filter)
			.sort({ createdAt: -1, _id: -1 })
			.limit(params.limit + 1)
			.lean<Notification[]>();
	}

	async countUnread(userId: Types.ObjectId): Promise<number> {
		return this.notificationModel.countDocuments({
			...this.baseFilter(userId),
			readAt: null,
		});
	}

	/**
	 * Marca como lida apenas se ainda estiver nao lida — `readAt: null` casa
	 * tanto com null quanto com campo ausente (docs anteriores a TRA-136).
	 * Devolve `null` quando nada foi atualizado, o que cobre dois casos que o
	 * service distingue depois: ja lida, ou nao pertence ao usuario.
	 */
	async markAsRead(
		userId: Types.ObjectId,
		notificationId: Types.ObjectId,
		readAt: Date
	): Promise<Notification | null> {
		return this.notificationModel
			.findOneAndUpdate(
				{ ...this.baseFilter(userId), _id: notificationId, readAt: null },
				{ $set: { readAt } },
				{ new: true }
			)
			.lean<Notification | null>();
	}

	async findOwned(
		userId: Types.ObjectId,
		notificationId: Types.ObjectId
	): Promise<Notification | null> {
		return this.notificationModel
			.findOne({ ...this.baseFilter(userId), _id: notificationId })
			.lean<Notification | null>();
	}

	async markAllAsRead(userId: Types.ObjectId, readAt: Date): Promise<number> {
		const result = await this.notificationModel.updateMany(
			{ ...this.baseFilter(userId), readAt: null },
			{ $set: { readAt } }
		);
		return result.modifiedCount ?? 0;
	}

	private baseFilter(userId: Types.ObjectId): FilterQuery<Notification> {
		return {
			user: userId,
			type: { $in: IN_APP_NOTIFICATION_TYPES },
		};
	}
}
