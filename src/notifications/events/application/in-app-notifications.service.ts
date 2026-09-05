import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
	DEFAULT_IN_APP_PAGE_SIZE,
	InAppNotificationItem,
	InAppNotificationPage,
	MAX_IN_APP_PAGE_SIZE,
} from '../domain/in-app-notification.types';
import { Notification } from '../schema/notification.model';
import { InAppNotificationsRepository } from '../infrastructure/in-app-notifications.repository';
import { toInAppNotificationItem } from './in-app-notification.mapper';
import {
	decodeNotificationCursor,
	encodeNotificationCursor,
} from './notification-cursor';

export type ListInAppInput = {
	limit?: number;
	cursor?: string;
	unreadOnly?: boolean;
};

/**
 * Centro de notificacoes in-app (TRA-136).
 *
 * Separado do `NotificationsService` de proposito: aquele e o lado de
 * escrita (decide preferencia, deduplica, dispara canais); este e o lado de
 * leitura do usuario final. Misturar os dois daria a um servico duas razoes
 * para mudar.
 *
 * O `userId` sempre vem do JWT, nunca do corpo/query — o controller nao tem
 * como passar outro dono, e o repositorio nao expoe consulta sem dono.
 */
@Injectable()
export class InAppNotificationsService {
	constructor(private readonly repository: InAppNotificationsRepository) {}

	async list(
		userId: string,
		input: ListInAppInput = {}
	): Promise<InAppNotificationPage> {
		const owner = this.toOwnerId(userId);
		const limit = this.normalizeLimit(input.limit);

		const docs = await this.repository.list({
			userId: owner,
			limit,
			cursor: decodeNotificationCursor(input.cursor),
			unreadOnly: input.unreadOnly === true,
		});

		const hasMore = docs.length > limit;
		const page = hasMore ? docs.slice(0, limit) : docs;

		const unreadCount = await this.repository.countUnread(owner);

		return {
			items: page.map(toInAppNotificationItem),
			nextCursor: hasMore ? this.cursorFor(page[page.length - 1]) : null,
			unreadCount,
		};
	}

	async unreadCount(userId: string): Promise<{ unreadCount: number }> {
		const unreadCount = await this.repository.countUnread(
			this.toOwnerId(userId)
		);
		return { unreadCount };
	}

	/**
	 * Idempotente: marcar de novo devolve o item com o `readAt` original,
	 * sem reescrever a data. O 404 e o mesmo para "nao existe" e "existe mas
	 * e de outro usuario" — distinguir os dois transformaria a rota em um
	 * oraculo de existencia de ids alheios.
	 */
	async markAsRead(
		userId: string,
		notificationId: string
	): Promise<InAppNotificationItem> {
		const owner = this.toOwnerId(userId);

		if (!Types.ObjectId.isValid(notificationId)) {
			throw new NotFoundException('Notificacao nao encontrada');
		}
		const id = new Types.ObjectId(notificationId);

		const updated = await this.repository.markAsRead(owner, id, new Date());
		if (updated) {
			return toInAppNotificationItem(updated);
		}

		const existing = await this.repository.findOwned(owner, id);
		if (!existing) {
			throw new NotFoundException('Notificacao nao encontrada');
		}

		return toInAppNotificationItem(existing);
	}

	async markAllAsRead(userId: string): Promise<{ updated: number }> {
		const updated = await this.repository.markAllAsRead(
			this.toOwnerId(userId),
			new Date()
		);
		return { updated };
	}

	private cursorFor(doc: Notification): string | null {
		if (!doc?._id) return null;
		const createdAt = doc.createdAt ?? doc._id.getTimestamp();
		return encodeNotificationCursor({ createdAt, id: doc._id });
	}

	private normalizeLimit(limit?: number): number {
		if (!limit || !Number.isFinite(limit)) return DEFAULT_IN_APP_PAGE_SIZE;
		return Math.min(Math.max(1, Math.trunc(limit)), MAX_IN_APP_PAGE_SIZE);
	}

	/**
	 * Um `userId` invalido chegando do JWT e falha de autenticacao, nao
	 * "lista vazia" — deixar passar viraria uma query com filtro quebrado.
	 */
	private toOwnerId(userId: string): Types.ObjectId {
		if (!userId || !Types.ObjectId.isValid(userId)) {
			throw new NotFoundException('Usuario nao encontrado');
		}
		return new Types.ObjectId(userId);
	}
}
