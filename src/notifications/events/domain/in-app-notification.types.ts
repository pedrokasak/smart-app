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
	/**
	 * Resumo do trackerr-ia (TRA-136, fase 5). Campo NOVO e opcional, ao
	 * lado de `title`/`body` — nunca no lugar deles. O texto determinista
	 * continua contando o que aconteceu, com os numeros exatos; este e uma
	 * camada a mais que o front pode renderizar ou ignorar. Ausente quando a
	 * IA nao respondeu, e ausente do JSON em vez de virar `null`.
	 */
	aiSummary?: string;
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
