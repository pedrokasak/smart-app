import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { conditionKeyOf } from '../../domain/attention.entities';
import type { ClientSnapshot } from '../../domain/attention.entities';
import {
	AdvisorType,
	AlertPriority,
	AlertRule,
	AlertStatus,
	OrgRole,
	SnapshotSource,
} from '../../domain/enums';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryAlertStore,
	InMemoryAssignmentStore,
	InMemoryClientContactStore,
	InMemoryClientProfileStore,
	InMemoryClientSnapshotStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
	InMemoryWealthDailyStore,
} from '../in-memory-stores.fixture';
import type { NewAlert } from '../ports/alert.store.port';
import { AlertService, ALERTS_VIEWED_EVENT } from './alert.service';
import { InvalidAlertInputError } from './attention-errors';
import { DashboardService } from './dashboard.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failing = false;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failing) throw new Error('audit down');
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

const addDays = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

describe('DashboardService', () => {
	let audit: FakeAuditTrail;
	let alerts: InMemoryAlertStore;
	let snapshots: InMemoryClientSnapshotStore;
	let wealth: InMemoryWealthDailyStore;
	let assignments: InMemoryAssignmentStore;
	let service: DashboardService;
	let orgId: string;
	const admin = () => ({ userId: ADMIN, orgId });
	const advisor = () => ({ userId: ADVISOR, orgId });

	beforeAll(() => {
		jest.useFakeTimers({
			now: NOW,
			doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
		});
	});

	afterAll(() => {
		jest.useRealTimers();
	});

	const snapshot = (
		clientProfileId: string,
		over: Partial<ClientSnapshot> = {}
	): ClientSnapshot => ({
		orgId,
		clientProfileId,
		asOf: TODAY,
		sources: [],
		totalMinor: 1000,
		verifiedMinor: 700,
		manualMinor: 300,
		relationshipStartedAt: new Date('2025-01-01T00:00:00.000Z'),
		lastContactAt: null,
		computedAt: NOW,
		...over,
	});

	const day = (
		clientProfileId: string,
		date: string,
		totalMinor: number
	): Promise<void> =>
		wealth.upsert({
			orgId,
			clientProfileId,
			date,
			source: SnapshotSource.AdvisorLedger,
			totalMinor,
			verifiedMinor: totalMinor,
			manualMinor: 0,
		});

	const alert = (clientProfileId: string, over: Partial<NewAlert> = {}) => {
		const base = {
			rule: AlertRule.Manual,
			source: null,
			key: Math.random().toString(36).slice(2),
			...over,
		};
		return {
			band: 1,
			priority: AlertPriority.P2,
			messageKey: 'advisor.alert.manual',
			params: {},
			evidence: {},
			dataAsOf: TODAY,
			provenance: null,
			lowConfidence: false,
			orgId,
			clientProfileId,
			conditionKey: conditionKeyOf(base),
			status: AlertStatus.Open,
			...base,
		} as NewAlert;
	};

	beforeEach(async () => {
		audit = new FakeAuditTrail();
		alerts = new InMemoryAlertStore();
		snapshots = new InMemoryClientSnapshotStore();
		wealth = new InMemoryWealthDailyStore();
		assignments = new InMemoryAssignmentStore();
		const memberships = new InMemoryMembershipStore();
		const relationships = new InMemoryRelationshipStore(assignments);
		const profiles = new InMemoryClientProfileStore();
		const orgs = new InMemoryOrganizationStore();
		orgId = (
			await orgs.create({ name: 'A', advisorType: AdvisorType.Assessor })
		).id;
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			new FakeAuditTrail()
		);
		const alertService = new AlertService(
			authz,
			alerts,
			assignments,
			relationships,
			new InMemoryInviteStore(),
			new InMemoryClientContactStore(),
			audit
		);
		service = new DashboardService(
			alertService,
			snapshots,
			wealth,
			alerts,
			audit
		);
	});

	it('sums the snapshots in scope and reports the oldest asOf', async () => {
		await snapshots.upsert(snapshot('c1', { asOf: '2025-06-16' }));
		await snapshots.upsert(
			snapshot('c2', {
				totalMinor: 500,
				verifiedMinor: 100,
				manualMinor: 400,
			})
		);
		const out = await service.get(admin());
		expect(out.clients).toBe(2);
		expect(out.wealth).toEqual({
			totalMinor: 1500,
			verifiedMinor: 800,
			manualMinor: 700,
			asOf: '2025-06-16',
		});
	});

	it('has null wealth fields and zero clients without snapshots', async () => {
		const out = await service.get(admin());
		expect(out.clients).toBe(0);
		expect(out.wealth).toEqual({
			totalMinor: null,
			verifiedMinor: null,
			manualMinor: null,
			asOf: null,
		});
		expect(out.change30d).toBeNull();
		expect(out.series).toEqual([]);
	});

	it('does not sum clients of another advisor', async () => {
		await assignments.assign(orgId, 'c1', ADVISOR, ADMIN);
		await snapshots.upsert(snapshot('c1'));
		await snapshots.upsert(snapshot('c2', { totalMinor: 9999 }));
		await day('c1', TODAY, 1000);
		await day('c2', TODAY, 9999);
		await alerts.insertMany([alert('c2', { priority: AlertPriority.P0 })]);

		const out = await service.get(advisor());
		expect(out.clients).toBe(1);
		expect(out.wealth.totalMinor).toBe(1000);
		expect(out.series).toEqual([{ date: TODAY, totalMinor: 1000 }]);
		expect(out.openAlerts.P0).toBe(0);
		expect(out.topAlerts).toEqual([]);
	});

	it('has change30d null with only 10 days of series', async () => {
		for (let i = 0; i <= 10; i += 1) {
			await day('c1', addDays(TODAY, -i), 1000);
		}
		const out = await service.get(admin());
		expect(out.series).toHaveLength(11);
		expect(out.change30d).toBeNull();
	});

	it('computes change30d against the latest row on or before today-30', async () => {
		await day('c1', addDays(TODAY, -33), 1000);
		await day('c1', addDays(TODAY, -5), 1500);
		await day('c1', TODAY, 1200);
		const out = await service.get(admin());
		expect(out.change30d).toEqual({
			deltaMinor: 200,
			pct: 0.2,
			clientsJoined: 0,
			clientsLeft: 0,
		});
	});

	it('finds the baseline even when it is older than the window', async () => {
		await day('c1', addDays(TODAY, -60), 1000);
		await day('c1', TODAY, 1100);
		const out = await service.get(admin(), 7);
		expect(out.series).toEqual([{ date: TODAY, totalMinor: 1100 }]);
		expect(out.change30d?.deltaMinor).toBe(100);
	});

	it('counts clients that joined or left between the two dates', async () => {
		const base = addDays(TODAY, -30);
		await day('c1', base, 1000);
		await day('c2', base, 500);
		await day('c1', TODAY, 1000);
		await day('c3', TODAY, 700);
		const out = await service.get(admin());
		expect(out.change30d).toEqual({
			deltaMinor: 200,
			pct: 200 / 1500,
			clientsJoined: 1,
			clientsLeft: 1,
		});
	});

	it('has pct null when the earlier total is zero', async () => {
		await day('c1', addDays(TODAY, -30), 0);
		await day('c1', TODAY, 100);
		const out = await service.get(admin());
		expect(out.change30d?.pct).toBeNull();
		expect(out.change30d?.deltaMinor).toBe(100);
	});

	it('counts open alerts by priority and returns at most 5 on top', async () => {
		const rows = [
			AlertPriority.P0,
			AlertPriority.P1,
			AlertPriority.P1,
			AlertPriority.P2,
			AlertPriority.P2,
			AlertPriority.P3,
			AlertPriority.P3,
		].map((priority) => alert('c1', { priority }));
		await alerts.insertMany(rows);
		const out = await service.get(admin());
		expect(out.openAlerts).toEqual({ P0: 1, P1: 2, P2: 2, P3: 2 });
		expect(out.topAlerts).toHaveLength(5);
		expect(out.topAlerts[0].priority).toBe(AlertPriority.P0);
	});

	it('lists only deadlines inside the next 14 days', async () => {
		const [inside, edge, outside] = await alerts.insertMany([
			alert('c1', { dueDate: addDays(TODAY, 5) } as Partial<NewAlert>),
			alert('c1', { dueDate: addDays(TODAY, 14) } as Partial<NewAlert>),
			alert('c1', { dueDate: addDays(TODAY, 15) } as Partial<NewAlert>),
		]);
		const [snoozed] = await alerts.insertMany([
			alert('c2', {
				status: AlertStatus.Snoozed,
				snoozedUntil: addDays(TODAY, 2),
			} as Partial<NewAlert>),
		]);
		const out = await service.get(admin());
		expect(out.deadlines).toEqual([
			{
				alertId: snoozed.id,
				clientProfileId: 'c2',
				kind: 'SNOOZE_END',
				date: addDays(TODAY, 2),
			},
			{
				alertId: inside.id,
				clientProfileId: 'c1',
				kind: 'DUE',
				date: addDays(TODAY, 5),
			},
			{
				alertId: edge.id,
				clientProfileId: 'c1',
				kind: 'DUE',
				date: addDays(TODAY, 14),
			},
		]);
		expect(out.deadlines.map((d) => d.alertId)).not.toContain(outside.id);
	});

	it('records exactly one viewed event with ids only', async () => {
		await alerts.insertMany([
			alert('c1', { dueDate: addDays(TODAY, 3) } as Partial<NewAlert>),
			alert('c2'),
		]);
		await service.get(admin());
		const events = audit.ofType(ALERTS_VIEWED_EVENT);
		expect(events).toHaveLength(1);
		expect(audit.recorded).toHaveLength(1);
		const payload = events[0].payload as {
			orgId: string;
			clientIds: string[];
		};
		expect(payload.orgId).toBe(orgId);
		expect([...payload.clientIds].sort()).toEqual(['c1', 'c2']);
		expect(JSON.stringify(payload)).not.toMatch(/Minor|name|email/);
	});

	it('fails closed when the audit fails', async () => {
		audit.failing = true;
		await expect(service.get(admin())).rejects.toThrow('audit down');
	});

	it.each([6, 366, 1.5, Number.NaN])('rejects days=%p', async (days) => {
		await expect(service.get(admin(), days)).rejects.toBeInstanceOf(
			InvalidAlertInputError
		);
		expect(audit.recorded).toHaveLength(0);
	});

	it('has change30d null when the newest row is older than today-30', async () => {
		await day('c1', addDays(TODAY, -60), 1000);
		await day('c1', addDays(TODAY, -40), 1100);
		const out = await service.get(admin(), 90);
		expect(out.series).toHaveLength(2);
		expect(out.change30d).toBeNull();
	});

	it('records no viewed event when a read fails after the audit would have run', async () => {
		await day('c1', addDays(TODAY, -30), 1000);
		await day('c1', TODAY, 1100);
		jest.spyOn(wealth, 'clientIdsOn').mockRejectedValueOnce(new Error('down'));
		await expect(service.get(admin())).rejects.toThrow('down');
		expect(audit.recorded).toHaveLength(0);
	});

	it('gives an ADVISOR without assignments zeros, empty lists and an audit with no ids', async () => {
		await snapshots.upsert(snapshot('c9'));
		await day('c9', TODAY, 1000);
		await alerts.insertMany([alert('c9')]);
		const out = await service.get(advisor());
		expect(out.clients).toBe(0);
		expect(out.wealth.totalMinor).toBeNull();
		expect(out.series).toEqual([]);
		expect(out.change30d).toBeNull();
		expect(out.openAlerts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
		expect(out.topAlerts).toEqual([]);
		expect(out.deadlines).toEqual([]);
		const events = audit.ofType(ALERTS_VIEWED_EVENT);
		expect(events).toHaveLength(1);
		expect(events[0].payload).toEqual({ orgId, clientIds: [] });
	});

	it('shows nothing for an empty organization and still audits once', async () => {
		const out = await service.get(admin());
		expect(out.openAlerts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
		expect(out.topAlerts).toEqual([]);
		expect(out.deadlines).toEqual([]);
		expect(audit.ofType(ALERTS_VIEWED_EVENT)).toHaveLength(1);
	});

	it('limits the series to the requested days', async () => {
		await day('c1', addDays(TODAY, -20), 100);
		await day('c1', addDays(TODAY, -3), 200);
		const out = await service.get(admin(), 7);
		expect(out.series).toEqual([{ date: addDays(TODAY, -3), totalMinor: 200 }]);
	});
});
