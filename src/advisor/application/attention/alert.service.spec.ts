import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { Alert, conditionKeyOf } from '../../domain/attention.entities';
import {
	AdvisorType,
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	InviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
	SnapshotSource,
} from '../../domain/enums';
import {
	AssigneeFilterForbiddenError,
	ClientNotAccessibleError,
} from '../access-errors';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryAlertStore,
	InMemoryAssignmentStore,
	InMemoryClientContactStore,
	InMemoryClientProfileStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from '../in-memory-stores.fixture';
import type { NewAlert } from '../ports/alert.store.port';
import {
	ALERT_BULK_UPDATED_EVENT,
	ALERT_CREATED_EVENT,
	ALERT_DISMISSED_EVENT,
	ALERT_HANDLED_EVENT,
	ALERT_SNOOZED_EVENT,
	ALERTS_VIEWED_EVENT,
	AlertService,
	CLIENT_REVIEWED_EVENT,
} from './alert.service';
import {
	AlertNotActiveError,
	AlertNotFoundError,
	BulkLimitExceededError,
	InvalidAlertInputError,
} from './attention-errors';
import { renderEmailDraft } from './email-draft';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	private failures = 0;

	failNext(times = 1): void {
		this.failures = times;
	}

	async record(event: AuditEventInput): Promise<void> {
		if (this.failures > 0) {
			this.failures -= 1;
			throw new Error('audit down');
		}
		this.recorded.push(event);
	}

	ofType(type: string): AuditEventInput[] {
		return this.recorded.filter((e) => e.type === type);
	}
}

const TODAY = '2025-06-17';
const NOW = new Date(`${TODAY}T15:00:00.000Z`);
const ADMIN = 'admin-1';
const ADVISOR = 'adv-1';
const OTHER_ADVISOR = 'adv-2';

const addDays = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

describe('AlertService', () => {
	let audit: FakeAuditTrail;
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let invites: InMemoryInviteStore;
	let alerts: InMemoryAlertStore;
	let contacts: InMemoryClientContactStore;
	let service: AlertService;
	let orgId: string;
	let otherOrgId: string;
	/** Atribuído ao ADVISOR. */
	let mine: { clientProfileId: string; relationshipId: string };
	/** Sem atribuição. */
	let theirs: { clientProfileId: string; relationshipId: string };

	const admin = () => ({ userId: ADMIN, orgId });
	const advisor = () => ({ userId: ADVISOR, orgId });
	const otherAdvisor = () => ({ userId: OTHER_ADVISOR, orgId });

	beforeAll(() => {
		jest.useFakeTimers({
			now: NOW,
			doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
		});
	});

	afterAll(() => {
		jest.useRealTimers();
	});

	const client = async (org: string, name = 'Cliente') => {
		const profile = profiles.seed({
			id: `client-${Math.random().toString(36).slice(2)}`,
			orgId: org,
			name,
			origin: ProfileOrigin.AdvisorCreated,
		});
		const relationship = await relationships.create({
			orgId: org,
			clientProfileId: profile.id,
			status: RelationshipStatus.Active,
		});
		return { clientProfileId: profile.id, relationshipId: relationship.id };
	};

	const ruleAlert = (
		clientProfileId: string,
		over: Partial<NewAlert> = {},
		org = orgId
	): NewAlert => {
		const base = {
			rule: AlertRule.PositionDrop,
			source: SnapshotSource.AdvisorLedger,
			key: 'PETR4',
			...over,
		};
		return {
			band: 1,
			priority: AlertPriority.P1,
			messageKey: 'advisor.alert.position_drop',
			params: { symbol: 'PETR4', dropPct: 12.5 },
			evidence: {},
			dataAsOf: '2025-06-16',
			provenance: null,
			lowConfidence: false,
			orgId: org,
			clientProfileId,
			conditionKey: conditionKeyOf(base),
			status: AlertStatus.Open,
			...base,
		} as NewAlert;
	};

	const seed = async (input: NewAlert): Promise<Alert> => {
		const [stored] = await alerts.insertMany([input]);
		return stored;
	};

	beforeEach(async () => {
		audit = new FakeAuditTrail();
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		profiles = new InMemoryClientProfileStore();
		invites = new InMemoryInviteStore();
		alerts = new InMemoryAlertStore();
		contacts = new InMemoryClientContactStore();
		const orgs = new InMemoryOrganizationStore();
		orgId = (
			await orgs.create({ name: 'A', advisorType: AdvisorType.Assessor })
		).id;
		otherOrgId = (
			await orgs.create({ name: 'B', advisorType: AdvisorType.Assessor })
		).id;
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		await memberships.create({
			userId: OTHER_ADVISOR,
			orgId,
			role: OrgRole.Advisor,
		});
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		service = new AlertService(
			authz,
			alerts,
			assignments,
			relationships,
			invites,
			contacts,
			audit
		);
		mine = await client(orgId);
		theirs = await client(orgId);
		await assignments.assign(orgId, mine.clientProfileId, ADVISOR, ADMIN);
	});

	/** O acesso ao cliente audita em outra trilha; só a do serviço falha. */
	const strictService = (failing: FakeAuditTrail): AlertService =>
		new AlertService(
			new AuthorizationService(
				memberships,
				relationships,
				profiles,
				assignments,
				new FakeAuditTrail()
			),
			alerts,
			assignments,
			relationships,
			invites,
			contacts,
			failing
		);

	describe('scopeClientIds', () => {
		it('is undefined for ORG_ADMIN and the assigned ids for ADVISOR', async () => {
			expect(await service.scopeClientIds(admin())).toBeUndefined();
			expect(await service.scopeClientIds(advisor())).toEqual([
				mine.clientProfileId,
			]);
			expect(await service.scopeClientIds(otherAdvisor())).toEqual([]);
		});

		it('pages through every assignment of the ADVISOR', async () => {
			const ids: string[] = [mine.clientProfileId];
			for (let i = 0; i < 620; i += 1) {
				const id = `bulk-${i}`;
				await assignments.assign(orgId, id, ADVISOR, ADMIN);
				ids.push(id);
			}
			const scope = await service.scopeClientIds(advisor());
			expect(scope).toHaveLength(621);
			expect(new Set(scope)).toEqual(new Set(ids));
		});
	});

	describe('list', () => {
		it('ORG_ADMIN sees every alert; ADVISOR sees only those of assigned clients', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			const b = await seed(ruleAlert(theirs.clientProfileId));
			await seed(ruleAlert(mine.clientProfileId, {}, otherOrgId));

			const all = await service.list(admin(), { limit: 50 });
			expect(all.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

			const own = await service.list(advisor(), { limit: 50 });
			expect(own.items.map((x) => x.id)).toEqual([a.id]);

			const none = await service.list(otherAdvisor(), { limit: 50 });
			expect(none.items).toEqual([]);
		});

		it('defaults to OPEN and honours status, priority and rule filters', async () => {
			const open = await seed(ruleAlert(mine.clientProfileId));
			const snoozed = await seed(
				ruleAlert(mine.clientProfileId, {
					key: 'VALE3',
					status: AlertStatus.Snoozed,
					priority: AlertPriority.P2,
				})
			);
			expect(
				(await service.list(admin(), { limit: 50 })).items.map((x) => x.id)
			).toEqual([open.id]);
			expect(
				(
					await service.list(admin(), {
						limit: 50,
						statuses: [AlertStatus.Snoozed],
					})
				).items.map((x) => x.id)
			).toEqual([snoozed.id]);
			expect(
				(
					await service.list(admin(), {
						limit: 50,
						statuses: [AlertStatus.Open, AlertStatus.Snoozed],
						priorities: [AlertPriority.P2],
					})
				).items.map((x) => x.id)
			).toEqual([snoozed.id]);
			expect(
				(
					await service.list(admin(), {
						limit: 50,
						rules: [AlertRule.NoContact],
					})
				).items
			).toEqual([]);
		});

		it('ORG_ADMIN filters by assignee me, none or a member', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			const b = await seed(ruleAlert(theirs.clientProfileId));
			expect(
				(
					await service.list(admin(), { limit: 50, assignee: ADVISOR })
				).items.map((x) => x.id)
			).toEqual([a.id]);
			expect(
				(
					await service.list(admin(), { limit: 50, assignee: 'none' })
				).items.map((x) => x.id)
			).toEqual([b.id]);
			expect(
				(await service.list(admin(), { limit: 50, assignee: 'me' })).items
			).toEqual([]);
		});

		it('ADVISOR with an assignee filter gets AssigneeFilterForbiddenError', async () => {
			await expect(
				service.list(advisor(), { limit: 50, assignee: 'me' })
			).rejects.toBeInstanceOf(AssigneeFilterForbiddenError);
			expect(audit.recorded).toEqual([]);
		});

		it('records one advisor.alerts.viewed with the client ids of the page', async () => {
			await seed(ruleAlert(mine.clientProfileId));
			await seed(ruleAlert(mine.clientProfileId, { key: 'VALE3' }));
			await seed(ruleAlert(theirs.clientProfileId));

			await service.list(admin(), { limit: 50 });

			const viewed = audit.ofType(ALERTS_VIEWED_EVENT);
			expect(viewed).toHaveLength(1);
			expect(audit.recorded).toHaveLength(1);
			expect(viewed[0]).toMatchObject({
				version: 1,
				subject: orgId,
				payload: { orgId },
			});
			expect([...(viewed[0].payload.clientIds as string[])].sort()).toEqual(
				[mine.clientProfileId, theirs.clientProfileId].sort()
			);
		});

		it('fails when the audit fails', async () => {
			await seed(ruleAlert(mine.clientProfileId));
			audit.failNext();
			await expect(service.list(admin(), { limit: 50 })).rejects.toThrow(
				'audit down'
			);
		});

		it('rejects a non-member', async () => {
			await expect(
				service.list({ userId: 'stranger', orgId }, { limit: 50 })
			).rejects.toThrow();
		});
	});

	describe('create', () => {
		it('stores a MANUAL alert with a generated key and audits it', async () => {
			const alert = await service.create(advisor(), {
				clientProfileId: mine.clientProfileId,
				title: '  Ligar sobre a reserva  ',
				priority: AlertPriority.P2,
				dueDate: addDays(TODAY, 3),
				note: 'Confirmar data',
			});

			expect(alert).toMatchObject({
				orgId,
				clientProfileId: mine.clientProfileId,
				rule: AlertRule.Manual,
				source: null,
				band: 1,
				priority: AlertPriority.P2,
				status: AlertStatus.Open,
				messageKey: 'advisor.alert.manual',
				title: 'Ligar sobre a reserva',
				note: 'Confirmar data',
				dueDate: addDays(TODAY, 3),
				createdByUserId: ADVISOR,
				dataAsOf: TODAY,
			});
			expect(alert.key).toMatch(/^[0-9a-f-]{36}$/);
			expect(alert.conditionKey).toBe(
				conditionKeyOf({
					rule: AlertRule.Manual,
					source: null,
					key: alert.key,
				})
			);
			const [created] = audit.ofType(ALERT_CREATED_EVENT);
			expect(created.payload).toEqual({
				orgId,
				clientProfileId: mine.clientProfileId,
				alertKey: alert.key,
				rule: AlertRule.Manual,
				priority: AlertPriority.P2,
			});
		});

		it('two manual alerts on the same client do not collide', async () => {
			const input = {
				clientProfileId: mine.clientProfileId,
				title: 'Ligar',
				priority: AlertPriority.P3,
			};
			const a = await service.create(admin(), input);
			const b = await service.create(admin(), input);
			expect(a.id).not.toBe(b.id);
		});

		it('ADVISOR cannot create an alert for an unassigned client (404)', async () => {
			await expect(
				service.create(advisor(), {
					clientProfileId: theirs.clientProfileId,
					title: 'Ligar',
					priority: AlertPriority.P3,
				})
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(
				await alerts.list(orgId, { statuses: [AlertStatus.Open], limit: 50 })
			).toMatchObject({ items: [] });
		});

		it.each([
			['empty title', { title: '   ' }, 'title'],
			['long title', { title: 'x'.repeat(121) }, 'title'],
			['long note', { note: 'x'.repeat(501) }, 'note'],
			['bad priority', { priority: 'P9' }, 'priority'],
			['bad due date', { dueDate: '2025-02-30' }, 'dueDate'],
		])('rejects %s', async (_name, over, field) => {
			await expect(
				service.create(admin(), {
					clientProfileId: mine.clientProfileId,
					title: 'Ligar',
					priority: AlertPriority.P3,
					...(over as object),
				})
			).rejects.toMatchObject({ field });
		});

		it('leaves nothing stored when the audit fails', async () => {
			const failing = new FakeAuditTrail();
			failing.failNext();
			await expect(
				strictService(failing).create(admin(), {
					clientProfileId: mine.clientProfileId,
					title: 'Ligar',
					priority: AlertPriority.P3,
				})
			).rejects.toThrow('audit down');
			expect(
				(await alerts.list(orgId, { statuses: [AlertStatus.Open], limit: 50 }))
					.items
			).toEqual([]);
		});
	});

	describe('Review Focus 3: unassigned ADVISOR', () => {
		it('gets 404 on handle, snooze and dismiss and the bulk skips the id', async () => {
			const alert = await seed(ruleAlert(theirs.clientProfileId));
			const until = addDays(TODAY, 5);

			await expect(
				service.handle(advisor(), alert.id, { via: AlertHandledVia.Reviewed })
			).rejects.toBeInstanceOf(AlertNotFoundError);
			await expect(
				service.snooze(advisor(), alert.id, until)
			).rejects.toBeInstanceOf(AlertNotFoundError);
			await expect(
				service.dismiss(advisor(), alert.id, 'Sem relevância')
			).rejects.toBeInstanceOf(AlertNotFoundError);
			expect(
				await service.bulk(advisor(), { action: 'REVIEW', ids: [alert.id] })
			).toEqual({ affected: 0, skipped: 1 });

			expect((await alerts.findById(orgId, alert.id))?.status).toBe(
				AlertStatus.Open
			);
			expect(audit.recorded).toEqual([]);
			expect(await contacts.find(orgId, theirs.clientProfileId)).toBeNull();
		});

		it('an alert of another org is the same 404', async () => {
			const foreign = await seed(
				ruleAlert(mine.clientProfileId, {}, otherOrgId)
			);
			await expect(
				service.handle(admin(), foreign.id, { via: AlertHandledVia.Reviewed })
			).rejects.toBeInstanceOf(AlertNotFoundError);
			await expect(
				service.handle(admin(), 'missing', { via: AlertHandledVia.Reviewed })
			).rejects.toBeInstanceOf(AlertNotFoundError);
		});
	});

	describe('handle', () => {
		it('REVIEWED records the contact, HANDLED and the audit', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));

			const result = await service.handle(advisor(), alert.id, {
				via: AlertHandledVia.Reviewed,
				note: 'Conversado',
			});

			expect(result.emailDraft).toBeUndefined();
			expect(result.alert).toMatchObject({
				status: AlertStatus.Handled,
				handledVia: AlertHandledVia.Reviewed,
				handledByUserId: ADVISOR,
				handledNote: 'Conversado',
				closedAt: NOW,
			});
			expect(result.alert.note).toBeUndefined();
			expect(await contacts.find(orgId, mine.clientProfileId)).toEqual(NOW);
			const [handled] = audit.ofType(ALERT_HANDLED_EVENT);
			expect(handled.payload).toEqual({
				orgId,
				alertId: alert.id,
				clientProfileId: mine.clientProfileId,
				rule: AlertRule.PositionDrop,
				priority: AlertPriority.P1,
				via: AlertHandledVia.Reviewed,
			});
		});

		it('R15: handling a MANUAL alert keeps the creation note', async () => {
			const manual = await service.create(admin(), {
				clientProfileId: mine.clientProfileId,
				title: 'Ligar',
				priority: AlertPriority.P2,
				note: 'Nota da criação',
			});
			const { alert: handled } = await service.handle(admin(), manual.id, {
				via: AlertHandledVia.Reviewed,
				note: 'Nota do tratamento',
			});
			expect(handled).toMatchObject({
				note: 'Nota da criação',
				handledNote: 'Nota do tratamento',
			});
		});

		it('M2: a failed contact write leaves the alert active', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			jest
				.spyOn(contacts, 'record')
				.mockRejectedValueOnce(new Error('contact down'));
			await expect(
				service.handle(admin(), alert.id, { via: AlertHandledVia.Reviewed })
			).rejects.toThrow('contact down');
			expect((await alerts.findById(orgId, alert.id))?.status).toBe(
				AlertStatus.Open
			);
		});

		it('handles a SNOOZED alert and clears snoozedUntil', async () => {
			const alert = await seed(
				ruleAlert(mine.clientProfileId, {
					status: AlertStatus.Snoozed,
					snoozedUntil: addDays(TODAY, 3),
				})
			);
			const { alert: handled } = await service.handle(admin(), alert.id, {
				via: AlertHandledVia.Reviewed,
			});
			expect(handled.status).toBe(AlertStatus.Handled);
			expect(handled.snoozedUntil).toBeUndefined();
		});

		it('EMAIL returns the draft with `to` from the accepted invite of an active relationship', async () => {
			await invites.create({
				orgId,
				clientProfileId: mine.clientProfileId,
				relationshipId: mine.relationshipId,
				email: 'cliente@exemplo.com',
				tokenHash: 'h1',
				status: InviteStatus.Accepted,
				expiresAt: NOW,
				resendCount: 0,
				invitedByUserId: ADMIN,
			});
			const alert = await seed(ruleAlert(mine.clientProfileId));

			const result = await service.handle(advisor(), alert.id, {
				via: AlertHandledVia.Email,
			});

			expect(result.alert).toMatchObject({
				status: AlertStatus.Handled,
				handledVia: AlertHandledVia.Email,
			});
			expect(result.emailDraft).toEqual({
				to: 'cliente@exemplo.com',
				...renderEmailDraft(alert),
			});
			expect(result.emailDraft?.body).toContain('PETR4');
			expect(result.emailDraft?.body).toContain('12,5%');
			expect(await contacts.find(orgId, mine.clientProfileId)).toEqual(NOW);
			// O e-mail não vai para a auditoria.
			expect(JSON.stringify(audit.recorded)).not.toContain('@');
		});

		it('EMAIL has no `to` when the relationship was revoked', async () => {
			await invites.create({
				orgId,
				clientProfileId: mine.clientProfileId,
				relationshipId: mine.relationshipId,
				email: 'cliente@exemplo.com',
				tokenHash: 'h1',
				status: InviteStatus.Accepted,
				expiresAt: NOW,
				resendCount: 0,
				invitedByUserId: ADMIN,
			});
			const relationship = await relationships.findById(mine.relationshipId);
			await relationships.save({
				...relationship!,
				status: RelationshipStatus.Revoked,
			});
			const alert = await seed(ruleAlert(mine.clientProfileId));

			const result = await service.handle(advisor(), alert.id, {
				via: AlertHandledVia.Email,
			});

			expect(result.emailDraft).toBeDefined();
			expect(result.emailDraft).not.toHaveProperty('to');
		});

		it('EMAIL has no `to` without an accepted invite', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			const result = await service.handle(admin(), alert.id, {
				via: AlertHandledVia.Email,
			});
			expect(result.emailDraft).not.toHaveProperty('to');
		});

		it('refuses an alert that is no longer active', async () => {
			const alert = await seed(
				ruleAlert(mine.clientProfileId, { status: AlertStatus.Resolved })
			);
			await expect(
				service.handle(admin(), alert.id, { via: AlertHandledVia.Reviewed })
			).rejects.toBeInstanceOf(AlertNotActiveError);
			expect(audit.recorded).toEqual([]);
		});

		it('rejects an invalid via or a long note', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			await expect(
				service.handle(admin(), alert.id, {
					via: 'PHONE' as AlertHandledVia,
				})
			).rejects.toMatchObject({ field: 'via' });
			await expect(
				service.handle(admin(), alert.id, {
					via: AlertHandledVia.Reviewed,
					note: 'x'.repeat(501),
				})
			).rejects.toMatchObject({ field: 'note' });
		});

		it('audit failure fails the action and leaves the alert and contact unchanged', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			audit.failNext();
			await expect(
				service.handle(admin(), alert.id, { via: AlertHandledVia.Email })
			).rejects.toThrow('audit down');
			expect(await alerts.findById(orgId, alert.id)).toEqual(alert);
			expect(await contacts.find(orgId, mine.clientProfileId)).toBeNull();
		});
	});

	describe('snooze', () => {
		it('snoozes up to today + 90 days and audits', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			const until = addDays(TODAY, 90);
			const snoozed = await service.snooze(advisor(), alert.id, until);
			expect(snoozed).toMatchObject({
				status: AlertStatus.Snoozed,
				snoozedUntil: until,
			});
			expect(audit.ofType(ALERT_SNOOZED_EVENT)[0].payload).toEqual({
				orgId,
				alertId: alert.id,
				clientProfileId: mine.clientProfileId,
				rule: AlertRule.PositionDrop,
				priority: AlertPriority.P1,
			});
		});

		it.each([
			['91 days ahead', addDays(TODAY, 91)],
			['today', TODAY],
			['the past', addDays(TODAY, -1)],
			['not a date', '17/06/2025'],
		])('rejects %s', async (_name, until) => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			await expect(
				service.snooze(admin(), alert.id, until)
			).rejects.toBeInstanceOf(InvalidAlertInputError);
			expect((await alerts.findById(orgId, alert.id))?.status).toBe(
				AlertStatus.Open
			);
		});

		it('audit failure leaves the alert unchanged', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			audit.failNext();
			await expect(
				service.snooze(admin(), alert.id, addDays(TODAY, 3))
			).rejects.toThrow('audit down');
			expect(await alerts.findById(orgId, alert.id)).toEqual(alert);
		});
	});

	describe('dismiss', () => {
		it('dismisses with a reason and audits without the reason text', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			const dismissed = await service.dismiss(
				advisor(),
				alert.id,
				'  Cliente já sabe  '
			);
			expect(dismissed).toMatchObject({
				status: AlertStatus.Dismissed,
				dismissReason: 'Cliente já sabe',
				closedAt: NOW,
			});
			const [event] = audit.ofType(ALERT_DISMISSED_EVENT);
			expect(JSON.stringify(event.payload)).not.toContain('Cliente');
		});

		it.each([
			['empty', '  '],
			['too long', 'x'.repeat(301)],
		])('rejects a reason that is %s', async (_name, reason) => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			await expect(
				service.dismiss(admin(), alert.id, reason)
			).rejects.toMatchObject({ field: 'reason' });
		});

		it('audit failure leaves the alert unchanged', async () => {
			const alert = await seed(ruleAlert(mine.clientProfileId));
			audit.failNext();
			await expect(
				service.dismiss(admin(), alert.id, 'Motivo')
			).rejects.toThrow('audit down');
			expect(await alerts.findById(orgId, alert.id)).toEqual(alert);
		});
	});

	describe('markReviewed', () => {
		const noContact = (clientProfileId: string, status = AlertStatus.Open) =>
			ruleAlert(clientProfileId, {
				rule: AlertRule.NoContact,
				source: null,
				key: 'client',
				priority: AlertPriority.P3,
				status,
				params: { days: 120 },
			});

		it('records the contact and moves the active NO_CONTACT to HANDLED/REVIEWED', async () => {
			const alert = await seed(noContact(mine.clientProfileId));
			const other = await seed(ruleAlert(mine.clientProfileId));

			await service.markReviewed(advisor(), mine.clientProfileId);

			expect(await alerts.findById(orgId, alert.id)).toMatchObject({
				status: AlertStatus.Handled,
				handledVia: AlertHandledVia.Reviewed,
				handledByUserId: ADVISOR,
			});
			expect((await alerts.findById(orgId, other.id))?.status).toBe(
				AlertStatus.Open
			);
			expect(await contacts.find(orgId, mine.clientProfileId)).toEqual(NOW);
			const [event] = audit.ofType(CLIENT_REVIEWED_EVENT);
			expect(event).toMatchObject({
				subject: mine.clientProfileId,
				payload: {
					orgId,
					clientProfileId: mine.clientProfileId,
					alertIds: [alert.id],
				},
			});
		});

		it('works with no NO_CONTACT alert and handles a snoozed one', async () => {
			await service.markReviewed(admin(), theirs.clientProfileId);
			expect(await contacts.find(orgId, theirs.clientProfileId)).toEqual(NOW);

			const snoozed = await seed(
				noContact(mine.clientProfileId, AlertStatus.Snoozed)
			);
			await service.markReviewed(admin(), mine.clientProfileId);
			expect((await alerts.findById(orgId, snoozed.id))?.status).toBe(
				AlertStatus.Handled
			);
		});

		it('ADVISOR gets 404 for an unassigned client', async () => {
			await seed(noContact(theirs.clientProfileId));
			await expect(
				service.markReviewed(advisor(), theirs.clientProfileId)
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(await contacts.find(orgId, theirs.clientProfileId)).toBeNull();
		});

		it('audit failure records no contact and keeps the alert', async () => {
			const alert = await seed(noContact(mine.clientProfileId));
			const failing = new FakeAuditTrail();
			failing.failNext();
			await expect(
				strictService(failing).markReviewed(admin(), mine.clientProfileId)
			).rejects.toThrow('audit down');
			expect(await alerts.findById(orgId, alert.id)).toEqual(alert);
			expect(await contacts.find(orgId, mine.clientProfileId)).toBeNull();
		});
	});

	describe('bulk', () => {
		it('REVIEW by ids: affects the active ones in scope, skips the rest, one audit event', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			const b = await seed(ruleAlert(mine.clientProfileId, { key: 'VALE3' }));
			const resolved = await seed(
				ruleAlert(mine.clientProfileId, {
					key: 'ITUB4',
					status: AlertStatus.Resolved,
				})
			);
			const foreign = await seed(ruleAlert(theirs.clientProfileId));

			const result = await service.bulk(advisor(), {
				action: 'REVIEW',
				ids: [a.id, b.id, resolved.id, foreign.id, 'missing', a.id],
			});

			expect(result).toEqual({ affected: 2, skipped: 3 });
			for (const id of [a.id, b.id]) {
				expect(await alerts.findById(orgId, id)).toMatchObject({
					status: AlertStatus.Handled,
					handledVia: AlertHandledVia.Reviewed,
				});
			}
			expect((await alerts.findById(orgId, foreign.id))?.status).toBe(
				AlertStatus.Open
			);
			expect(await contacts.find(orgId, mine.clientProfileId)).toEqual(NOW);
			expect(await contacts.find(orgId, theirs.clientProfileId)).toBeNull();
			const events = audit.ofType(ALERT_BULK_UPDATED_EVENT);
			expect(events).toHaveLength(1);
			expect(audit.recorded).toHaveLength(1);
			expect(events[0].payload).toEqual({
				orgId,
				action: 'REVIEW',
				alertIds: [a.id, b.id],
			});
		});

		it('M2: a failed contact write in a REVIEW bulk changes no alert', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			jest
				.spyOn(contacts, 'record')
				.mockRejectedValueOnce(new Error('contact down'));
			await expect(
				service.bulk(admin(), { action: 'REVIEW', ids: [a.id] })
			).rejects.toThrow('contact down');
			expect((await alerts.findById(orgId, a.id))?.status).toBe(
				AlertStatus.Open
			);
		});

		it('SNOOZE by filter covers only what the member sees', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			const foreign = await seed(ruleAlert(theirs.clientProfileId));
			const until = addDays(TODAY, 10);

			const result = await service.bulk(advisor(), {
				action: 'SNOOZE',
				filter: { rules: [AlertRule.PositionDrop] },
				until,
			});

			expect(result).toEqual({ affected: 1, skipped: 0 });
			expect(await alerts.findById(orgId, a.id)).toMatchObject({
				status: AlertStatus.Snoozed,
				snoozedUntil: until,
			});
			expect((await alerts.findById(orgId, foreign.id))?.status).toBe(
				AlertStatus.Open
			);
		});

		it('DISMISS by filter for ORG_ADMIN reaches every client', async () => {
			await seed(ruleAlert(mine.clientProfileId));
			await seed(ruleAlert(theirs.clientProfileId));
			const result = await service.bulk(admin(), {
				action: 'DISMISS',
				filter: {},
				reason: 'Mercado volátil',
			});
			expect(result).toEqual({ affected: 2, skipped: 0 });
		});

		it('ADVISOR cannot use an assignee filter in the bulk', async () => {
			await expect(
				service.bulk(advisor(), {
					action: 'REVIEW',
					filter: { assignee: 'me' },
				})
			).rejects.toBeInstanceOf(AssigneeFilterForbiddenError);
		});

		it('DISMISS without a reason is an error', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			await expect(
				service.bulk(admin(), { action: 'DISMISS', ids: [a.id] })
			).rejects.toMatchObject({ field: 'reason' });
			await expect(
				service.bulk(admin(), { action: 'DISMISS', ids: [a.id], reason: ' ' })
			).rejects.toBeInstanceOf(InvalidAlertInputError);
			expect((await alerts.findById(orgId, a.id))?.status).toBe(
				AlertStatus.Open
			);
		});

		it('SNOOZE needs a valid until', async () => {
			await expect(
				service.bulk(admin(), { action: 'SNOOZE', ids: ['x'] })
			).rejects.toMatchObject({ field: 'until' });
			await expect(
				service.bulk(admin(), {
					action: 'SNOOZE',
					ids: ['x'],
					until: addDays(TODAY, 91),
				})
			).rejects.toMatchObject({ field: 'until' });
		});

		it('takes ids or filter, never both nor neither', async () => {
			await expect(
				service.bulk(admin(), { action: 'REVIEW', ids: ['x'], filter: {} })
			).rejects.toBeInstanceOf(InvalidAlertInputError);
			await expect(
				service.bulk(admin(), { action: 'REVIEW' })
			).rejects.toBeInstanceOf(InvalidAlertInputError);
			await expect(
				service.bulk(admin(), { action: 'REVIEW', ids: [] })
			).rejects.toBeInstanceOf(InvalidAlertInputError);
			await expect(
				service.bulk(admin(), { action: 'ARCHIVE' as 'REVIEW', ids: ['x'] })
			).rejects.toMatchObject({ field: 'action' });
		});

		it('501 ids are an error', async () => {
			const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
			await expect(
				service.bulk(admin(), { action: 'REVIEW', ids })
			).rejects.toBeInstanceOf(BulkLimitExceededError);
		});

		it('500 ids are accepted', async () => {
			const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
			expect(await service.bulk(admin(), { action: 'REVIEW', ids })).toEqual({
				affected: 0,
				skipped: 500,
			});
		});

		it('a filter that matches more than 500 alerts is an error', async () => {
			const many: NewAlert[] = Array.from({ length: 501 }, (_, i) =>
				ruleAlert(mine.clientProfileId, { key: `SYM${i}` })
			);
			await alerts.insertMany(many);
			await expect(
				service.bulk(admin(), { action: 'REVIEW', filter: {} })
			).rejects.toBeInstanceOf(BulkLimitExceededError);
			expect(
				(
					await alerts.list(orgId, {
						statuses: [AlertStatus.Handled],
						limit: 10,
					})
				).items
			).toEqual([]);
		});

		it('a filter never reaches closed alerts', async () => {
			await seed(
				ruleAlert(mine.clientProfileId, { status: AlertStatus.Dismissed })
			);
			expect(
				await service.bulk(admin(), {
					action: 'REVIEW',
					filter: { statuses: [AlertStatus.Dismissed] },
				})
			).toEqual({ affected: 0, skipped: 0 });
		});

		it('audit failure leaves every alert unchanged', async () => {
			const a = await seed(ruleAlert(mine.clientProfileId));
			audit.failNext();
			await expect(
				service.bulk(admin(), { action: 'REVIEW', ids: [a.id] })
			).rejects.toThrow('audit down');
			expect(await alerts.findById(orgId, a.id)).toEqual(a);
			expect(await contacts.find(orgId, mine.clientProfileId)).toBeNull();
		});
	});
});
