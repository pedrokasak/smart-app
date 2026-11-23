import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { Alert, conditionKeyOf } from '../../domain/attention.entities';
import { Membership } from '../../domain/entities';
import {
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	OrgRole,
	RelationshipStatus,
} from '../../domain/enums';
import { AssigneeFilterForbiddenError } from '../access-errors';
import {
	ADVISOR_ALERT_STORE,
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_CONTACT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from '../advisor.tokens';
import { AuthorizationService } from '../authorization.service';
import type { AccessContext } from '../authorization.service';
import type {
	AlertPage,
	AlertStorePort,
	NewAlert,
} from '../ports/alert.store.port';
import type { AssignmentStorePort } from '../ports/assignment.store.port';
import type { ClientContactStorePort } from '../ports/client-contact.store.port';
import type { InviteStorePort } from '../ports/invite.store.port';
import type { RelationshipStorePort } from '../ports/relationship.store.port';
import {
	AlertNotActiveError,
	AlertNotFoundError,
	BulkLimitExceededError,
	InvalidAlertInputError,
} from './attention-errors';
import { renderEmailDraft } from './email-draft';

export const ALERTS_VIEWED_EVENT = 'advisor.alerts.viewed';
export const ALERT_CREATED_EVENT = 'advisor.alert.created';
export const ALERT_HANDLED_EVENT = 'advisor.alert.handled';
export const ALERT_SNOOZED_EVENT = 'advisor.alert.snoozed';
export const ALERT_DISMISSED_EVENT = 'advisor.alert.dismissed';
export const ALERT_BULK_UPDATED_EVENT = 'advisor.alert.bulk_updated';
export const CLIENT_REVIEWED_EVENT = 'advisor.client.reviewed';

/** Lote: até 500 alertas por vez (B7). */
export const ALERT_BULK_MAX = 500;
/** Adiamento: até 90 dias à frente. */
export const SNOOZE_MAX_DAYS = 90;
const TITLE_MAX = 120;
const NOTE_MAX = 500;
const REASON_MAX = 300;
const PAGE = 500;
const CHUNK = 50;

const ACTIVE: AlertStatus[] = [AlertStatus.Open, AlertStatus.Snoozed];
const ALL_RELATIONSHIP_STATUSES = Object.values(RelationshipStatus);
const BULK_ACTIONS = ['REVIEW', 'SNOOZE', 'DISMISS'] as const;

export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface ListFilter {
	statuses?: AlertStatus[];
	priorities?: AlertPriority[];
	rules?: AlertRule[];
	/** `me`, `none` (sem assessor) ou o userId de um membro; só ORG_ADMIN. */
	assignee?: 'me' | 'none' | string;
}

export type ListAlertsQuery = ListFilter & { cursor?: string; limit: number };

export interface CreateAlertInput {
	clientProfileId: string;
	title: string;
	priority: AlertPriority;
	dueDate?: string;
	note?: string;
}

export interface HandleAlertInput {
	via: AlertHandledVia;
	note?: string;
}

export interface EmailDraft {
	to?: string;
	subject: string;
	body: string;
}

export interface BulkInput {
	action: BulkAction;
	ids?: string[];
	filter?: ListFilter;
	until?: string;
	reason?: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const isIsoDate = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
};

const addDays = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return isoDate(date);
};

/** Texto aparado entre `min` e `max`; `null` se inválido. */
const boundedText = (value: unknown, min: number, max: number) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
};

/** Nota opcional: vazia vira ausente; longa demais é erro. */
const optionalNote = (value: unknown): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new InvalidAlertInputError('note');
	const trimmed = value.trim();
	if (trimmed.length > NOTE_MAX) throw new InvalidAlertInputError('note');
	return trimmed.length > 0 ? trimmed : undefined;
};

/** `until` estritamente depois de hoje e até hoje + 90 (UTC, como o job). */
const checkedUntil = (until: unknown, now: Date): string => {
	const today = isoDate(now);
	if (
		!isIsoDate(until) ||
		until <= today ||
		until > addDays(today, SNOOZE_MAX_DAYS)
	) {
		throw new InvalidAlertInputError('until');
	}
	return until;
};

const checkedReason = (reason: unknown): string => {
	const value = boundedText(reason, 1, REASON_MAX);
	if (value === null) throw new InvalidAlertInputError('reason');
	return value;
};

async function inChunks<T, R>(
	items: T[],
	run: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < items.length; i += CHUNK) {
		out.push(...(await Promise.all(items.slice(i, i + CHUNK).map(run))));
	}
	return out;
}

/**
 * Fila de alertas do assessor e as ações sobre ela. ADVISOR só alcança os
 * clientes atribuídos a ele; ORG_ADMIN, a organização toda. Um alerta fora
 * do alcance é o mesmo `AlertNotFoundError` de um alerta inexistente, sem
 * auditoria de acesso. Toda escrita audita antes de gravar: se a auditoria
 * falha, nada muda (falha fechada).
 */
@Injectable()
export class AlertService {
	constructor(
		private readonly authz: AuthorizationService,
		@Inject(ADVISOR_ALERT_STORE) private readonly alerts: AlertStorePort,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_INVITE_STORE) private readonly invites: InviteStorePort,
		@Inject(ADVISOR_CLIENT_CONTACT_STORE)
		private readonly contacts: ClientContactStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	/** `undefined` para ORG_ADMIN (a org toda); os atribuídos para ADVISOR. */
	async scopeClientIds(ctx: AccessContext): Promise<string[] | undefined> {
		const membership = await this.authz.ensureOrgMember(ctx);
		return this.scopeOf(membership);
	}

	/** Uma página da fila; grava um `advisor.alerts.viewed` com os clientes. */
	async list(ctx: AccessContext, q: ListAlertsQuery): Promise<AlertPage> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const clientIds = await this.clientIdsFor(ctx, membership, q.assignee);
		const page = await this.alerts.list(ctx.orgId, {
			clientIds,
			statuses: q.statuses?.length ? q.statuses : [AlertStatus.Open],
			priorities: q.priorities,
			rules: q.rules,
			cursor: q.cursor,
			limit: q.limit,
		});
		await this.record(ctx, ALERTS_VIEWED_EVENT, ctx.orgId, {
			orgId: ctx.orgId,
			clientIds: [...new Set(page.items.map((a) => a.clientProfileId))],
		});
		return page;
	}

	/** Alerta MANUAL (R2): a chave é um uuid gerado aqui, faixa 1. */
	async create(ctx: AccessContext, input: CreateAlertInput): Promise<Alert> {
		const title = boundedText(input.title, 1, TITLE_MAX);
		if (title === null) throw new InvalidAlertInputError('title');
		if (!Object.values(AlertPriority).includes(input.priority)) {
			throw new InvalidAlertInputError('priority');
		}
		if (input.dueDate !== undefined && !isIsoDate(input.dueDate)) {
			throw new InvalidAlertInputError('dueDate');
		}
		const note = optionalNote(input.note);
		await this.authz.ensureCanAccessClient(
			ctx,
			input.clientProfileId,
			'VIEW_PORTFOLIO'
		);

		const key = randomUUID();
		const base = { rule: AlertRule.Manual, source: null, key };
		const alert: NewAlert = {
			...base,
			band: 1,
			priority: input.priority,
			messageKey: 'advisor.alert.manual',
			params: {},
			evidence: {},
			dataAsOf: isoDate(new Date()),
			provenance: null,
			lowConfidence: false,
			orgId: ctx.orgId,
			clientProfileId: input.clientProfileId,
			conditionKey: conditionKeyOf(base),
			status: AlertStatus.Open,
			createdByUserId: ctx.userId,
			title,
			...(note !== undefined ? { note } : {}),
			...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
		};
		await this.record(ctx, ALERT_CREATED_EVENT, input.clientProfileId, {
			orgId: ctx.orgId,
			clientProfileId: input.clientProfileId,
			alertKey: key,
			rule: AlertRule.Manual,
			priority: input.priority,
		});
		const [stored] = await this.alerts.insertMany([alert]);
		if (!stored) throw new Error('Manual alert was not stored');
		return stored;
	}

	/**
	 * HANDLED com `via`, e o cliente ganha um "último contato". Com EMAIL,
	 * devolve o rascunho; `to` só com convite aceito e vínculo ACTIVE.
	 */
	async handle(
		ctx: AccessContext,
		id: string,
		input: HandleAlertInput
	): Promise<{ alert: Alert; emailDraft?: EmailDraft }> {
		if (!Object.values(AlertHandledVia).includes(input.via)) {
			throw new InvalidAlertInputError('via');
		}
		const note = optionalNote(input.note);
		const alert = await this.reachableActive(ctx, id);
		await this.record(ctx, ALERT_HANDLED_EVENT, alert.id, {
			...this.ids(alert),
			via: input.via,
		});
		const now = new Date();
		const handled = await this.patchActive(id, {
			status: AlertStatus.Handled,
			handledVia: input.via,
			handledByUserId: ctx.userId,
			closedAt: now,
			snoozedUntil: undefined,
			...(note !== undefined ? { note } : {}),
		});
		await this.contacts.record(
			ctx.orgId,
			alert.clientProfileId,
			now,
			ctx.userId
		);
		if (input.via !== AlertHandledVia.Email) return { alert: handled };
		const to = await this.emailTo(ctx.orgId, alert.clientProfileId);
		return {
			alert: handled,
			emailDraft: {
				...(to !== undefined ? { to } : {}),
				...renderEmailDraft(alert),
			},
		};
	}

	async snooze(ctx: AccessContext, id: string, until: string): Promise<Alert> {
		const checked = checkedUntil(until, new Date());
		const alert = await this.reachableActive(ctx, id);
		await this.record(ctx, ALERT_SNOOZED_EVENT, alert.id, this.ids(alert));
		return this.patchActive(id, {
			status: AlertStatus.Snoozed,
			snoozedUntil: checked,
		});
	}

	async dismiss(
		ctx: AccessContext,
		id: string,
		reason: string
	): Promise<Alert> {
		const checked = checkedReason(reason);
		const alert = await this.reachableActive(ctx, id);
		await this.record(ctx, ALERT_DISMISSED_EVENT, alert.id, this.ids(alert));
		return this.patchActive(id, {
			status: AlertStatus.Dismissed,
			dismissReason: checked,
			closedAt: new Date(),
			snoozedUntil: undefined,
		});
	}

	/**
	 * "Marcar revisado" no cliente: registra o contato e passa o NO_CONTACT
	 * ativo a HANDLED/REVIEWED. A recomputação seguinte move a base.
	 */
	async markReviewed(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<void> {
		await this.authz.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		const { items } = await this.alerts.list(ctx.orgId, {
			clientIds: [clientProfileId],
			statuses: ACTIVE,
			rules: [AlertRule.NoContact],
			limit: PAGE,
		});
		await this.record(ctx, CLIENT_REVIEWED_EVENT, clientProfileId, {
			orgId: ctx.orgId,
			clientProfileId,
			alertIds: items.map((a) => a.id),
		});
		const now = new Date();
		await this.contacts.record(ctx.orgId, clientProfileId, now, ctx.userId);
		for (const alert of items) {
			await this.alerts.patch(alert.id, this.reviewedPatch(ctx, now), ACTIVE);
		}
	}

	/**
	 * Lote (B7): `ids` ou `filter`, até 500. Pula, em `skipped`, o que está
	 * fora do alcance, não existe ou já não está ativo. Um evento só, com os
	 * ids afetados, gravado antes de mudar qualquer alerta.
	 */
	async bulk(
		ctx: AccessContext,
		input: BulkInput
	): Promise<{ affected: number; skipped: number }> {
		const now = new Date();
		const patch = this.bulkPatch(ctx, input, now);
		const hasIds = input.ids !== undefined;
		if (hasIds === (input.filter !== undefined)) {
			throw new InvalidAlertInputError('ids');
		}
		if (hasIds && (!Array.isArray(input.ids) || input.ids.length === 0)) {
			throw new InvalidAlertInputError('ids');
		}
		if (hasIds && input.ids!.length > ALERT_BULK_MAX) {
			throw new BulkLimitExceededError(ALERT_BULK_MAX);
		}
		const membership = await this.authz.ensureOrgMember(ctx);
		const { eligible, skipped } = hasIds
			? await this.eligibleByIds(ctx, membership, input.ids!)
			: await this.eligibleByFilter(ctx, membership, input.filter!);
		if (eligible.length === 0) return { affected: 0, skipped };

		await this.record(ctx, ALERT_BULK_UPDATED_EVENT, ctx.orgId, {
			orgId: ctx.orgId,
			action: input.action,
			alertIds: eligible.map((a) => a.id),
		});
		const results = await inChunks(eligible, (a) =>
			this.alerts.patch(a.id, patch, ACTIVE)
		);
		const affected = results.filter((r): r is Alert => r !== null);
		if (input.action === 'REVIEW') {
			const clients = [...new Set(affected.map((a) => a.clientProfileId))];
			await inChunks(clients, (clientProfileId) =>
				this.contacts.record(ctx.orgId, clientProfileId, now, ctx.userId)
			);
		}
		return {
			affected: affected.length,
			skipped: skipped + eligible.length - affected.length,
		};
	}

	/** Valida a ação e monta o patch dela antes de qualquer leitura. */
	private bulkPatch(
		ctx: AccessContext,
		input: BulkInput,
		now: Date
	): Partial<Alert> {
		switch (input.action) {
			case 'REVIEW':
				return this.reviewedPatch(ctx, now);
			case 'SNOOZE':
				return {
					status: AlertStatus.Snoozed,
					snoozedUntil: checkedUntil(input.until, now),
				};
			case 'DISMISS':
				return {
					status: AlertStatus.Dismissed,
					dismissReason: checkedReason(input.reason),
					closedAt: now,
					snoozedUntil: undefined,
				};
			default:
				throw new InvalidAlertInputError('action');
		}
	}

	private reviewedPatch(ctx: AccessContext, now: Date): Partial<Alert> {
		return {
			status: AlertStatus.Handled,
			handledVia: AlertHandledVia.Reviewed,
			handledByUserId: ctx.userId,
			closedAt: now,
			snoozedUntil: undefined,
		};
	}

	private async eligibleByIds(
		ctx: AccessContext,
		membership: Membership,
		ids: string[]
	): Promise<{ eligible: Alert[]; skipped: number }> {
		const unique = [...new Set(ids)];
		const scope = await this.scopeOf(membership);
		const inScope = scope === undefined ? undefined : new Set(scope);
		const found = await inChunks(unique, (id) =>
			this.alerts.findById(ctx.orgId, id)
		);
		const eligible = found.filter(
			(a): a is Alert =>
				a !== null &&
				ACTIVE.includes(a.status) &&
				(inScope === undefined || inScope.has(a.clientProfileId))
		);
		return { eligible, skipped: unique.length - eligible.length };
	}

	/** O filtro só alcança alertas ativos; mais de 500 é erro. */
	private async eligibleByFilter(
		ctx: AccessContext,
		membership: Membership,
		filter: ListFilter
	): Promise<{ eligible: Alert[]; skipped: number }> {
		const clientIds = await this.clientIdsFor(ctx, membership, filter.assignee);
		const statuses = (
			filter.statuses?.length ? filter.statuses : [AlertStatus.Open]
		).filter((s) => ACTIVE.includes(s));
		if (statuses.length === 0) return { eligible: [], skipped: 0 };
		const page = await this.alerts.list(ctx.orgId, {
			clientIds,
			statuses,
			priorities: filter.priorities,
			rules: filter.rules,
			limit: ALERT_BULK_MAX,
		});
		if (page.nextCursor !== null) {
			throw new BulkLimitExceededError(ALERT_BULK_MAX);
		}
		return { eligible: page.items, skipped: 0 };
	}

	/** O alerta existe na org, o cliente está no alcance e ele está ativo. */
	private async reachableActive(
		ctx: AccessContext,
		id: string
	): Promise<Alert> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const alert = await this.alerts.findById(ctx.orgId, id);
		if (
			!alert ||
			!(await this.authz.isClientInScope(membership, alert.clientProfileId))
		) {
			throw new AlertNotFoundError();
		}
		if (!ACTIVE.includes(alert.status)) throw new AlertNotActiveError();
		return alert;
	}

	/** Só aplica se ainda estiver ativo; uma corrida perdida é 409. */
	private async patchActive(id: string, patch: Partial<Alert>): Promise<Alert> {
		const updated = await this.alerts.patch(id, patch, ACTIVE);
		if (!updated) throw new AlertNotActiveError();
		return updated;
	}

	private ids(alert: Alert): Record<string, string> {
		return {
			orgId: alert.orgId,
			alertId: alert.id,
			clientProfileId: alert.clientProfileId,
			rule: alert.rule,
			priority: alert.priority,
		};
	}

	private async scopeOf(membership: Membership): Promise<string[] | undefined> {
		if (membership.role === OrgRole.OrgAdmin) return undefined;
		return this.assignedIds(membership.orgId, membership.userId);
	}

	/**
	 * Clientes da fila. ADVISOR: os atribuídos a ele, sem filtro de assessor.
	 * ORG_ADMIN: todos, ou os do `assignee` pedido.
	 */
	private async clientIdsFor(
		ctx: AccessContext,
		membership: Membership,
		assignee: ListFilter['assignee']
	): Promise<string[] | undefined> {
		if (membership.role !== OrgRole.OrgAdmin) {
			if (assignee !== undefined) throw new AssigneeFilterForbiddenError();
			return this.assignedIds(ctx.orgId, ctx.userId);
		}
		if (assignee === undefined) return undefined;
		if (assignee === 'none') return this.unassignedIds(ctx.orgId);
		return this.assignedIds(
			ctx.orgId,
			assignee === 'me' ? ctx.userId : assignee
		);
	}

	private async assignedIds(orgId: string, userId: string): Promise<string[]> {
		const ids: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.assignments.listClientIdsByUser(orgId, userId, {
				cursor,
				limit: PAGE,
			});
			ids.push(...page.ids);
			cursor = page.nextCursor ?? undefined;
		} while (cursor !== undefined);
		return ids;
	}

	/** Clientes sem nenhum assessor, de qualquer status de vínculo. */
	private async unassignedIds(orgId: string): Promise<string[]> {
		const ids = new Set<string>();
		let cursor: string | undefined;
		do {
			const page = await this.relationships.listUnassignedByOrg(orgId, {
				statuses: ALL_RELATIONSHIP_STATUSES,
				cursor,
				limit: PAGE,
			});
			for (const r of page.items) ids.add(r.clientProfileId);
			cursor = page.nextCursor ?? undefined;
		} while (cursor !== undefined);
		return [...ids];
	}

	/** O e-mail do convite aceito que criou o vínculo, só com vínculo ACTIVE. */
	private async emailTo(
		orgId: string,
		clientProfileId: string
	): Promise<string | undefined> {
		const relationship = await this.relationships.findByOrgAndClient(
			orgId,
			clientProfileId
		);
		if (relationship?.status !== RelationshipStatus.Active) return undefined;
		const invite = await this.invites.findAcceptedByRelationship(
			relationship.id
		);
		if (
			!invite ||
			invite.orgId !== orgId ||
			invite.clientProfileId !== clientProfileId
		) {
			return undefined;
		}
		return invite.email;
	}

	private async record(
		ctx: AccessContext,
		type: string,
		subject: string,
		payload: Record<string, unknown>
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject,
			actorRef: actorRefOf(ctx.userId),
			occurredAt: new Date(),
			payload,
		});
	}
}
