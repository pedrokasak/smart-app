import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Notification } from 'src/notifications/events/schema/notification.model';
import { IN_APP_NOTIFICATION_TYPES } from 'src/notifications/events/domain/in-app-notification.types';

/**
 * Unico lugar do digest que fala Mongo com a colecao de notificacoes
 * (TRA-136, fase 7). Leitura pura: o digest nunca escreve em `Notification`
 * — nao marca lida, nao marca digerida, nao cria doc. As notificacoes
 * continuam pertencendo ao pipeline de eventos; o digest so as le.
 *
 * Como no repositorio do centro in-app, TODA consulta daqui carrega `user`
 * e a janela de tempo no filtro. Nao existe metodo que leia notificacao
 * sem dono e sem periodo.
 *
 * O filtro casa com o indice ja existente `{ user: 1, createdAt: -1 }`.
 */
@Injectable()
export class DigestNotificationsRepository {
	constructor(
		@InjectModel('Notification')
		private readonly notificationModel: Model<Notification>
	) {}

	/**
	 * As `limit` notificacoes mais recentes do periodo, da mais nova para a
	 * mais antiga. Recorte pelo mesmo periodo que o builder ja calculou —
	 * ver `DigestNotificationsService`.
	 */
	async findInPeriod(
		userId: Types.ObjectId,
		periodStart: Date,
		periodEnd: Date,
		limit: number
	): Promise<Notification[]> {
		return this.notificationModel
			.find(this.periodFilter(userId, periodStart, periodEnd))
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit)
			.lean<Notification[]>();
	}

	/**
	 * Total do periodo, para que o e-mail possa dizer quantas ficaram de
	 * fora do teto. Contagem coberta pelo mesmo indice da listagem.
	 */
	async countInPeriod(
		userId: Types.ObjectId,
		periodStart: Date,
		periodEnd: Date
	): Promise<number> {
		return this.notificationModel.countDocuments(
			this.periodFilter(userId, periodStart, periodEnd)
		);
	}

	private periodFilter(
		userId: Types.ObjectId,
		periodStart: Date,
		periodEnd: Date
	): FilterQuery<Notification> {
		return {
			user: userId,
			type: { $in: IN_APP_NOTIFICATION_TYPES },
			createdAt: { $gte: periodStart, $lte: periodEnd },
		};
	}
}
