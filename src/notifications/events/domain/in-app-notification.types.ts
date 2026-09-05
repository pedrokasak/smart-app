import { NotificationType } from './notification.types';

/**
 * Item do centro de notificacoes in-app, exatamente no formato que o `web`
 * consome. `action` e opcional: quando o tipo nao tem CTA, o campo some do
 * JSON em vez de virar null.
 */
export type InAppNotificationAction = {
	label: string;
	route: string;
};

export type InAppNotificationItem = {
	id: string;
	type: string;
	title: string;
	body: string;
	createdAt: string;
	readAt: string | null;
	action?: InAppNotificationAction;
};

export type InAppNotificationPage = {
	items: InAppNotificationItem[];
	nextCursor: string | null;
	unreadCount: number;
};

/**
 * Tipos elegiveis para exibicao no centro in-app.
 *
 * Hoje todo tipo suportado e elegivel — o registro existe para que um tipo
 * futuro que so faca sentido por e-mail (ou um doc legado com tipo que o
 * template nao conhece mais) possa ser excluido da lista sem mudar as
 * consultas nem quebrar o mapper.
 */
export const IN_APP_NOTIFICATION_TYPES: NotificationType[] =
	Object.values(NotificationType);

export const DEFAULT_IN_APP_PAGE_SIZE = 20;
export const MAX_IN_APP_PAGE_SIZE = 50;
