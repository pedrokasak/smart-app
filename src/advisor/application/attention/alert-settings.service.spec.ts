import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { DEFAULT_ALERT_SETTINGS } from '../../domain/alert-settings';
import {
	AdvisorType,
	AlertPriority,
	AlertRule,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../../domain/enums';
import { RoleRequiredError } from '../access-errors';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryAlertSettingsStore,
	InMemoryAlertStore,
	InMemoryAllocationTargetStore,
	InMemoryAssignmentStore,
	InMemoryBenchmarkSeries,
	InMemoryClientContactStore,
	InMemoryClientProfileStore,
	InMemoryClientSnapshotStore,
	InMemoryConsentStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPriceHistory,
	InMemoryRelationshipStore,
	InMemorySharedPortfolioSource,
	InMemoryTransactionStore,
	InMemoryWealthDailyStore,
} from '../in-memory-stores.fixture';
import { PortfolioMetricsService } from '../metrics/portfolio-metrics.service';
import { SharedPortfolioService } from '../shared-portfolio.service';
import {
	ALERT_SETTINGS_UPDATED_EVENT,
	AlertSettingsService,
} from './alert-settings.service';
import { InvalidAlertSettingsError } from './attention-errors';
import { ClientSnapshotService } from './client-snapshot.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	private failures = 0;

	failNext(): void {
		this.failures = 1;
	}

	async record(event: AuditEventInput): Promise<void> {
		if (this.failures > 0) {
			this.failures -= 1;
			throw new Error('audit down');
		}
		this.recorded.push(event);
	}
}

const TODAY = '2025-06-17';
const NOW = new Date(`${TODAY}T23:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN = 'admin-1';
const ADVISOR = 'adv-1';

describe('AlertSettingsService', () => {
	let audit: FakeAuditTrail;
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let store: InMemoryAlertSettingsStore;
	let authz: AuthorizationService;
	let service: AlertSettingsService;
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

	beforeEach(async () => {
		audit = new FakeAuditTrail();
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		profiles = new InMemoryClientProfileStore();
		store = new InMemoryAlertSettingsStore();
		const orgs = new InMemoryOrganizationStore();
		orgId = (
			await orgs.create({ name: 'A', advisorType: AdvisorType.Assessor })
		).id;
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		service = new AlertSettingsService(authz, store, audit);
	});

	it('get returns the defaults and engineEnabledAt null when nothing is stored', async () => {
		expect(await service.get(advisor())).toEqual({
			settings: DEFAULT_ALERT_SETTINGS,
			engineEnabledAt: null,
		});
		expect(audit.recorded).toEqual([]);
	});

	it('get returns what is stored', async () => {
		const at = new Date(NOW.getTime() - 10 * DAY_MS);
		await store.ensureEngineEnabled(orgId, at);
		await store.upsertSettings(
			orgId,
			{ ...DEFAULT_ALERT_SETTINGS, largeSellsPct: 30 },
			ADMIN
		);
		expect(await service.get(advisor())).toEqual({
			settings: { ...DEFAULT_ALERT_SETTINGS, largeSellsPct: 30 },
			engineEnabledAt: at,
		});
	});

	it('get rejects a non-member', async () => {
		await expect(service.get({ userId: 'stranger', orgId })).rejects.toThrow();
	});

	it('put stores the whole set (omitted fields go back to default) and audits', async () => {
		await store.upsertSettings(
			orgId,
			{ ...DEFAULT_ALERT_SETTINGS, largeSellsPct: 30 },
			ADMIN
		);
		const saved = await service.put(admin(), { noContactDays: [60, 120] });

		const expected = { ...DEFAULT_ALERT_SETTINGS, noContactDays: [60, 120] };
		expect(saved.settings).toEqual(expected);
		expect((await store.find(orgId))?.settings).toEqual(expected);
		expect(audit.recorded).toHaveLength(1);
		expect(audit.recorded[0]).toMatchObject({
			type: ALERT_SETTINGS_UPDATED_EVENT,
			version: 1,
			subject: orgId,
			payload: { orgId },
		});
	});

	it('ADVISOR gets RoleRequiredError and nothing is stored', async () => {
		await expect(
			service.put(advisor(), { noContactDays: [60, 120] })
		).rejects.toBeInstanceOf(RoleRequiredError);
		expect(await store.find(orgId)).toBeNull();
		expect(audit.recorded).toEqual([]);
	});

	it.each([
		['out of order', { positionDropPct: [20, 10] }, 'positionDropPct'],
		['out of range', { concentrationPct: [2, 35] }, 'concentrationPct'],
		['bad single value', { largeSellsPct: 0 }, 'largeSellsPct'],
	])(
		'an invalid set (%s) is InvalidAlertSettingsError(field)',
		async (_n, input, field) => {
			const error = await service
				.put(admin(), input as never)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(InvalidAlertSettingsError);
			expect(error).toMatchObject({ field });
			expect(await store.find(orgId)).toBeNull();
		}
	);

	it('audit failure fails the put and stores nothing', async () => {
		audit.failNext();
		await expect(
			service.put(admin(), { noContactDays: [60, 120] })
		).rejects.toThrow('audit down');
		expect(await store.find(orgId)).toBeNull();
	});

	it('noContactDays [60, 120] is applied by the next recompute, counted from engineEnabledAt', async () => {
		const prices = new InMemoryPriceHistory();
		const benchmarks = new InMemoryBenchmarkSeries();
		benchmarks.set('CDI', 0.01);
		benchmarks.set('IBOV', 0.02);
		benchmarks.set('IPCA', 0.004);
		const transactions = new InMemoryTransactionStore();
		const source = new InMemorySharedPortfolioSource();
		const alerts = new InMemoryAlertStore();
		const snapshot = new ClientSnapshotService(
			relationships,
			profiles,
			transactions,
			new PortfolioMetricsService(
				authz,
				transactions,
				new InMemoryAllocationTargetStore(),
				prices,
				benchmarks
			),
			new SharedPortfolioService(
				authz,
				relationships,
				new InMemoryConsentStore(),
				profiles,
				source,
				prices,
				benchmarks
			),
			new InMemoryClientSnapshotStore(),
			new InMemoryWealthDailyStore(),
			alerts,
			store,
			new InMemoryClientContactStore()
		);
		const profile = profiles.seed({
			id: 'client-1',
			orgId,
			name: 'Cliente',
			origin: ProfileOrigin.AdvisorCreated,
		});
		const relationship = await relationships.create({
			orgId,
			clientProfileId: profile.id,
			status: RelationshipStatus.Active,
		});
		relationships.setCreatedAt(
			relationship.id,
			new Date(NOW.getTime() - 400 * DAY_MS)
		);
		// O motor ligou há 70 dias: com o padrão (90), ainda não há alerta.
		await store.ensureEngineEnabled(
			orgId,
			new Date(NOW.getTime() - 70 * DAY_MS)
		);
		await snapshot.recompute(orgId, profile.id, NOW);
		expect(await alerts.listForClient(orgId, profile.id, new Date(0))).toEqual(
			[]
		);

		await service.put(admin(), { noContactDays: [60, 120] });
		await snapshot.recompute(orgId, profile.id, NOW);

		const open = await alerts.listForClient(orgId, profile.id, new Date(0));
		expect(open.map((a) => [a.rule, a.priority, a.params])).toEqual([
			[AlertRule.NoContact, AlertPriority.P3, { days: 69 }],
		]);
	});
});
