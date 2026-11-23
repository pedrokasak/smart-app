import { Alert } from '../../domain/attention.entities';
import { AlertPriority, AlertRule, AlertStatus } from '../../domain/enums';

export type NewAlert = Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>;

export interface AlertFilter {
	/** Lista vazia => nenhum resultado. */
	clientIds?: string[];
	statuses: AlertStatus[];
	priorities?: AlertPriority[];
	rules?: AlertRule[];
}

export interface AlertListQuery extends AlertFilter {
	cursor?: string;
	limit: number;
}

export interface AlertPage {
	items: Alert[];
	nextCursor: string | null;
}

export type OpenAlertCounts = Record<AlertPriority, number>;

/** Teto de `idsByFilter`: o lote em massa. */
export const ALERT_IDS_BY_FILTER_MAX = 1000;

export interface AlertStorePort {
	/**
	 * Grava só os alertas novos. Uma condição (`conditionKey`) com alerta
	 * OPEN/SNOOZED no cliente é ignorada (não duplica); devolve só os gravados,
	 * na ordem de entrada.
	 */
	insertMany(alerts: NewAlert[]): Promise<Alert[]>;
	/**
	 * Alertas do cliente: os ativos (OPEN/SNOOZED), de qualquer idade, e os
	 * demais alterados a partir de `since`. Do mais antigo para o mais novo.
	 */
	listForClient(
		orgId: string,
		clientProfileId: string,
		since: Date
	): Promise<Alert[]>;
	/**
	 * Atômico. Com `expectedStatus`, só aplica se o status atual estiver na
	 * lista; senão (ou se o id não existe) devolve null. Chave presente com
	 * valor `undefined` remove o campo. Mudar `priority` atualiza o rank.
	 * `id`, `orgId`, `clientProfileId`, `conditionKey` e datas de registro não
	 * mudam por aqui.
	 */
	patch(
		id: string,
		patch: Partial<Alert>,
		expectedStatus?: AlertStatus[]
	): Promise<Alert | null>;
	/** Resolve (sistema) só os alertas ativos entre `ids`; devolve quantos. */
	resolveMany(ids: string[], at: Date): Promise<number>;
	findById(orgId: string, id: string): Promise<Alert | null>;
	/**
	 * Ordem: rank da prioridade, `dueDate` (sem prazo por último), `createdAt`
	 * decrescente, `id`. `limit` é limitado a 1..500. Cursor inválido lança
	 * `InvalidCursorError`.
	 */
	list(orgId: string, q: AlertListQuery): Promise<AlertPage>;
	/** Alertas OPEN por prioridade (adiados não contam). */
	countOpenByPriority(
		orgId: string,
		clientIds?: string[]
	): Promise<OpenAlertCounts>;
	/**
	 * Prazos de `from` a `to` (YYYY-MM-DD, inclusivos): `dueDate` dos MANUAL
	 * ativos e `snoozedUntil` dos adiados. Do prazo mais próximo; até 500.
	 */
	listDeadlines(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<Alert[]>;
	/** Ids que casam com o filtro, na ordem de `list`; até `max` (teto 1000). */
	idsByFilter(orgId: string, q: AlertFilter, max: number): Promise<string[]>;
	deleteByClient(orgId: string, clientProfileId: string): Promise<void>;
}
