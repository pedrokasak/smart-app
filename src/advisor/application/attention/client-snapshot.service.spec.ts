import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { conditionKeyOf } from '../../domain/attention.entities';
import {
	AdvisorType,
	AlertPriority,
	AlertRule,
	AlertStatus,
	AssetClass,
	OrgRole,
	ProfileOrigin,
	Provenance,
	RelationshipStatus,
	SnapshotSource,
	TransactionSide,
	TransactionSource,
} from '../../domain/enums';
import { NewTransaction } from '../../domain/portfolio.entities';
import {
	AuthorizationService,
	CLIENT_ACCESSED_EVENT,
} from '../authorization.service';
import { ConsentService } from '../consent.service';
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
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryInviteeIdentity,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPriceHistory,
	InMemoryRelationshipStore,
	InMemorySharedPortfolioSource,
	InMemoryTransactionStore,
	InMemoryWealthDailyStore,
	RecordingAttentionPurge,
	RecordingRelationshipNotifier,
	RecordingSnapshotTrigger,
} from '../in-memory-stores.fixture';
import { InviteService } from '../invite.service';
import { isTradingDay } from '../metrics/portfolio-math';
import { PortfolioMetricsService } from '../metrics/portfolio-metrics.service';
import type { NewAlert } from '../ports/alert.store.port';
import type { DailyCloseMinor } from '../ports/price-history.port';
import { RelationshipService } from '../relationship.service';
import { SharedPortfolioService } from '../shared-portfolio.service';
import {
	ClientSnapshotService,
	SOURCE_METRICS_FAILED,
	SOURCE_READ_FAILED,
} from './client-snapshot.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];

	async record(event: AuditEventInput): Promise<void> {
		this.recorded.push(event);
	}
}

const TODAY = '2025-06-17';
const NOW = new Date(`${TODAY}T23:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;
const INVESTOR = 'inv-1';
const ADVISOR = 'adv-1';

const addDay = (iso: string): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

const DAYS: string[] = [];
for (let day = '2025-05-05'; day <= TODAY; day = addDay(day)) {
	if (isTradingDay(day)) DAYS.push(day);
}
const flat = (closeMinor: number): DailyCloseMinor[] =>
	DAYS.map((date) => ({ date, closeMinor }));

describe('ClientSnapshotService', () => {
	let audit: FakeAuditTrail;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let consents: InMemoryConsentStore;
	let transactions: InMemoryTransactionStore;
	let prices: InMemoryPriceHistory;
	let source: InMemorySharedPortfolioSource;
	let snapshots: InMemoryClientSnapshotStore;
	let wealth: InMemoryWealthDailyStore;
	let alerts: InMemoryAlertStore;
	let settings: InMemoryAlertSettingsStore;
	let contacts: InMemoryClientContactStore;
	let metrics: PortfolioMetricsService;
	let service: ClientSnapshotService;
	let inviteService: InviteService;
	let consentService: ConsentService;
	let notifier: InMemoryInviteNotifier;
	let orgs: InMemoryOrganizationStore;
	let identity: InMemoryInviteeIdentity;
	let invites: InMemoryInviteStore;
	let orgId: string;

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
		const memberships = new InMemoryMembershipStore();
		const assignments = new InMemoryAssignmentStore();
		orgs = new InMemoryOrganizationStore();
		relationships = new InMemoryRelationshipStore(assignments);
		profiles = new InMemoryClientProfileStore();
		consents = new InMemoryConsentStore();
		transactions = new InMemoryTransactionStore();
		prices = new InMemoryPriceHistory();
		source = new InMemorySharedPortfolioSource();
		snapshots = new InMemoryClientSnapshotStore();
		wealth = new InMemoryWealthDailyStore();
		alerts = new InMemoryAlertStore();
		settings = new InMemoryAlertSettingsStore();
		contacts = new InMemoryClientContactStore();
		notifier = new InMemoryInviteNotifier();
		const benchmarks = new InMemoryBenchmarkSeries();
		identity = new InMemoryInviteeIdentity();
		invites = new InMemoryInviteStore();

		const org = await orgs.create({
			name: 'Org A',
			advisorType: AdvisorType.Assessor,
		});
		orgId = org.id;
		await memberships.create({
			userId: ADVISOR,
			orgId,
			role: OrgRole.OrgAdmin,
		});
		identity.set(INVESTOR, { email: 'joao@exemplo.com', emailVerified: true });
		for (const symbol of ['PETR4', 'VALE3', 'ITUB4', 'BBAS3']) {
			prices.set(symbol, flat(1000));
		}
		benchmarks.set('CDI', 0.01);
		benchmarks.set('IBOV', 0.02);
		benchmarks.set('IPCA', 0.004);

		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		const relationshipService = new RelationshipService(relationships);
		metrics = new PortfolioMetricsService(
			authz,
			transactions,
			new InMemoryAllocationTargetStore(),
			prices,
			benchmarks
		);
		const shared = new SharedPortfolioService(
			authz,
			relationships,
			consents,
			profiles,
			source,
			prices,
			benchmarks
		);
		service = new ClientSnapshotService(
			relationships,
			profiles,
			transactions,
			metrics,
			shared,
			snapshots,
			wealth,
			alerts,
			settings,
			contacts
		);
		inviteService = new InviteService(
			authz,
			relationshipService,
			invites,
			orgs,
			profiles,
			notifier,
			assignments,
			audit,
			new RecordingAttentionPurge()
		);
		consentService = new ConsentService(
			invites,
			consents,
			relationships,
			relationshipService,
			profiles,
			orgs,
			identity,
			source,
			audit,
			new RecordingSnapshotTrigger(),
			new RecordingAttentionPurge(),
			new RecordingRelationshipNotifier()
		);
	});

	const tx = (
		clientProfileId: string,
		over: Partial<NewTransaction> = {}
	): NewTransaction => ({
		orgId,
		clientProfileId,
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		side: TransactionSide.Buy,
		quantity: 40,
		unitPriceMinor: 1000,
		feesMinor: 0,
		currency: 'BRL',
		tradeDate: DAYS[0],
		provenance: Provenance.Verified,
		source: TransactionSource.CsvImport,
		createdByUserId: ADVISOR,
		...over,
	});

	/** Livro do assessor: PETR4 com 40% e três ativos de 20%. */
	const concentratedLedger = async (clientProfileId: string) => {
		await transactions.createMany([
			tx(clientProfileId),
			tx(clientProfileId, { symbol: 'VALE3', quantity: 20 }),
			tx(clientProfileId, { symbol: 'ITUB4', quantity: 20 }),
			tx(clientProfileId, { symbol: 'BBAS3', quantity: 20 }),
		]);
	};

	/** Cliente criado pelo escritório, com relação ACTIVE de `ageDays`. */
	const advisorClient = async (ageDays = 400) => {
		const profile = profiles.seed({
			id: `client-${Math.random().toString(36).slice(2)}`,
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
			new Date(NOW.getTime() - ageDays * DAY_MS)
		);
		return { clientProfileId: profile.id, relationshipId: relationship.id };
	};

	/** Cliente do B2C com a carteira p1 (100% PETR4) compartilhada. */
	/** Carteira B2C só com PETR4 (100%). */
	const petrPortfolio = (id: string) =>
		source.add(INVESTOR, {
			id,
			name: `Carteira ${id}`,
			holdings: [
				{
					symbol: 'PETR4',
					assetClass: AssetClass.Stock,
					quantity: 10,
					costMinor: 10000,
					provenance: Provenance.Verified,
				},
			],
			trades: [
				{
					symbol: 'PETR4',
					assetClass: AssetClass.Stock,
					side: TransactionSide.Buy,
					quantity: 10,
					unitPriceMinor: 1000,
					feesMinor: 0,
					tradeDate: DAYS[0],
					provenance: Provenance.Verified,
					createdAt: new Date(`${DAYS[0]}T12:00:00.000Z`),
				},
			],
		});

	const sharingClient = async () => {
		petrPortfolio('p1');
		const created = await inviteService.createInvite(
			{ userId: ADVISOR, orgId },
			{ email: 'joao@exemplo.com', clientName: 'Joao Silva' }
		);
		const grant = await consentService.acceptInvite(
			INVESTOR,
			notifier.sent[notifier.sent.length - 1].token,
			['p1']
		);
		relationships.setCreatedAt(
			grant.relationshipId,
			new Date(NOW.getTime() - 400 * DAY_MS)
		);
		return {
			clientProfileId: created.clientProfileId,
			relationshipId: grant.relationshipId,
		};
	};

	const alertsOf = (clientProfileId: string) =>
		alerts.listForClient(orgId, clientProfileId, new Date(0));

	const manualAlert = (clientProfileId: string): NewAlert => {
		const base = {
			rule: AlertRule.Manual,
			source: null,
			key: 'manual-1',
		};
		return {
			...base,
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
			title: 'Ligar',
		};
	};

	it('Review Focus 1: engine on today, 400-day client at 40% opens CONCENTRATION P1 and no NO_CONTACT', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);

		const result = await service.recompute(orgId, clientProfileId, NOW);

		const open = await alertsOf(clientProfileId);
		expect(open.map((a) => [a.rule, a.priority, a.source, a.key])).toEqual([
			[
				AlertRule.Concentration,
				AlertPriority.P1,
				SnapshotSource.AdvisorLedger,
				'PETR4',
			],
		]);
		expect(open[0]).toMatchObject({
			status: AlertStatus.Open,
			lowConfidence: false,
			messageKey: 'advisor.alert.concentration',
		});
		expect(result).toEqual({ opened: 1, updated: 0, resolved: 0 });
		expect((await settings.find(orgId))?.engineEnabledAt).toEqual(NOW);

		const snapshot = await snapshots.find(orgId, clientProfileId);
		expect(snapshot).toMatchObject({
			asOf: TODAY,
			totalMinor: 100000,
			verifiedMinor: 100000,
			manualMinor: 0,
			lastContactAt: null,
			relationshipStartedAt: new Date(NOW.getTime() - 400 * DAY_MS),
		});
		expect(wealth.all).toEqual([
			{
				orgId,
				clientProfileId,
				date: TODAY,
				source: SnapshotSource.AdvisorLedger,
				totalMinor: 100000,
				verifiedMinor: 100000,
				manualMinor: 0,
			},
		]);
	});

	it('counts "no contact" from the day the engine was turned on', async () => {
		await settings.ensureEngineEnabled(
			orgId,
			new Date(NOW.getTime() - 100 * DAY_MS)
		);
		const { clientProfileId } = await advisorClient(400);

		await service.recompute(orgId, clientProfileId, NOW);

		// A regra conta dias inteiros até o início de hoje (UTC): 99.
		const open = await alertsOf(clientProfileId);
		expect(open.map((a) => [a.rule, a.priority, a.params])).toEqual([
			[AlertRule.NoContact, AlertPriority.P3, { days: 99 }],
		]);
	});

	it('a recent contact moves the baseline and resolves NO_CONTACT', async () => {
		await settings.ensureEngineEnabled(
			orgId,
			new Date(NOW.getTime() - 100 * DAY_MS)
		);
		const { clientProfileId } = await advisorClient(400);
		await service.recompute(orgId, clientProfileId, NOW);

		await contacts.record(
			orgId,
			clientProfileId,
			new Date(NOW.getTime() - DAY_MS),
			ADVISOR
		);
		const result = await service.recompute(orgId, clientProfileId, NOW);

		expect(result).toEqual({ opened: 0, updated: 0, resolved: 1 });
		const [alert] = await alertsOf(clientProfileId);
		expect(alert.status).toBe(AlertStatus.Resolved);
		expect(
			(await snapshots.find(orgId, clientProfileId))?.lastContactAt
		).toEqual(new Date(NOW.getTime() - DAY_MS));
	});

	it('R14: a recompute on the wake date reopens a snoozed manual alert', async () => {
		const { clientProfileId } = await advisorClient(10);
		const [due] = await alerts.insertMany([
			{
				...manualAlert(clientProfileId),
				status: AlertStatus.Snoozed,
				snoozedUntil: TODAY,
			},
		]);
		const later = {
			...manualAlert(clientProfileId),
			key: 'manual-2',
			conditionKey: conditionKeyOf({
				rule: AlertRule.Manual,
				source: null,
				key: 'manual-2',
			}),
			status: AlertStatus.Snoozed,
			snoozedUntil: addDay(TODAY),
		};
		const [notYet] = await alerts.insertMany([later]);

		const result = await service.recompute(orgId, clientProfileId, NOW);

		expect(result).toEqual({ opened: 0, updated: 1, resolved: 0 });
		const woken = await alerts.findById(orgId, due.id);
		expect(woken?.status).toBe(AlertStatus.Open);
		expect(woken?.snoozedUntil).toBeUndefined();
		expect(woken?.title).toBe('Ligar');
		expect((await alerts.findById(orgId, notYet.id))?.status).toBe(
			AlertStatus.Snoozed
		);
	});

	it('recomputing twice changes nothing', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);
		const alertsBefore = await alertsOf(clientProfileId);
		const snapshotBefore = await snapshots.find(orgId, clientProfileId);
		const rowsBefore = wealth.all;

		const again = await service.recompute(orgId, clientProfileId, NOW);

		expect(again).toEqual({ opened: 0, updated: 0, resolved: 0 });
		expect(await alertsOf(clientProfileId)).toEqual(alertsBefore);
		expect(await snapshots.find(orgId, clientProfileId)).toEqual(
			snapshotBefore
		);
		expect(wealth.all).toEqual(rowsBefore);
	});

	it('sums the advisor-ledger sells of the last 30 days into LARGE_SELLS', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		const thirtyFiveDaysAgo = DAYS.find(
			(d) =>
				d >= new Date(NOW.getTime() - 35 * DAY_MS).toISOString().slice(0, 10)
		) as string;
		await transactions.createMany([
			// Fora da janela: não conta.
			tx(clientProfileId, {
				symbol: 'VALE3',
				side: TransactionSide.Buy,
				quantity: 30,
				tradeDate: DAYS[0],
			}),
			tx(clientProfileId, {
				symbol: 'VALE3',
				side: TransactionSide.Sell,
				quantity: 30,
				tradeDate: thirtyFiveDaysAgo,
			}),
		]);
		await service.recompute(orgId, clientProfileId, NOW);
		expect(
			(await alertsOf(clientProfileId)).some(
				(a) => a.rule === AlertRule.LargeSells
			)
		).toBe(false);

		// 25 000 de 100 000 vendidos ontem: 25% > 20%.
		await transactions.createMany([
			tx(clientProfileId, {
				symbol: 'VALE3',
				side: TransactionSide.Buy,
				quantity: 25,
				tradeDate: DAYS[0],
			}),
			tx(clientProfileId, {
				symbol: 'VALE3',
				side: TransactionSide.Sell,
				quantity: 25,
				tradeDate: DAYS[DAYS.length - 2],
			}),
		]);
		await service.recompute(orgId, clientProfileId, NOW);

		const sells = (await alertsOf(clientProfileId)).find(
			(a) => a.rule === AlertRule.LargeSells
		);
		expect(sells).toMatchObject({
			priority: AlertPriority.P1,
			evidence: { sellsMinor30d: 25000, totalValueMinor: 100000 },
		});
	});

	it('Review Focus 4: after the consent is revoked, B2C alerts are RESOLVED, B2C rows go and ledger rows stay', async () => {
		const { clientProfileId, relationshipId } = await sharingClient();
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);

		const before = await alertsOf(clientProfileId);
		expect(before.map((a) => [a.rule, a.source, a.key]).sort()).toEqual(
			[
				[AlertRule.Concentration, SnapshotSource.AdvisorLedger, 'PETR4'],
				[AlertRule.Concentration, SnapshotSource.B2cShared, 'PETR4'],
			].sort()
		);
		expect(wealth.all.map((r) => [r.source, r.portfolioId]).sort()).toEqual(
			[
				[SnapshotSource.AdvisorLedger, undefined],
				[SnapshotSource.B2cShared, 'p1'],
			].sort()
		);

		// O consentimento acaba; a relação ainda está ACTIVE nesta leitura.
		await consents.revokeActive(relationshipId, INVESTOR, NOW);
		const result = await service.recompute(orgId, clientProfileId, NOW);

		expect(result).toEqual({ opened: 0, updated: 0, resolved: 1 });
		const after = await alertsOf(clientProfileId);
		expect(
			after.find((a) => a.source === SnapshotSource.B2cShared)?.status
		).toBe(AlertStatus.Resolved);
		expect(
			after.find((a) => a.source === SnapshotSource.AdvisorLedger)?.status
		).toBe(AlertStatus.Open);
		expect(wealth.all.map((r) => r.source)).toEqual([
			SnapshotSource.AdvisorLedger,
		]);
		const snapshot = await snapshots.find(orgId, clientProfileId);
		expect(snapshot?.sources.map((s) => s.source)).toEqual([
			SnapshotSource.AdvisorLedger,
		]);
	});

	it('drops the rows of a portfolio that is no longer shared', async () => {
		source.add(INVESTOR, { id: 'p2', name: 'Outra' });
		const { clientProfileId, relationshipId } = await sharingClient();
		await consentService.changeSharedPortfolios(INVESTOR, relationshipId, [
			'p1',
			'p2',
		]);
		await service.recompute(orgId, clientProfileId, NOW);
		expect(
			wealth.all
				.filter((r) => r.source === SnapshotSource.B2cShared)
				.map((r) => r.portfolioId)
				.sort()
		).toEqual(['p1', 'p2']);

		await consentService.changeSharedPortfolios(INVESTOR, relationshipId, [
			'p2',
		]);
		await service.recompute(orgId, clientProfileId, NOW);

		expect(
			wealth.all
				.filter((r) => r.source === SnapshotSource.B2cShared)
				.map((r) => r.portfolioId)
		).toEqual(['p2']);
	});

	it('a revoked relationship deletes the read model, resolves system alerts and keeps manual ones', async () => {
		const { clientProfileId, relationshipId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);
		await alerts.insertMany([manualAlert(clientProfileId)]);
		await contacts.record(orgId, clientProfileId, NOW, ADVISOR);
		const relationship = await relationships.findById(relationshipId);
		await relationships.save({
			...relationship!,
			status: RelationshipStatus.Revoked,
		});

		const result = await service.recompute(orgId, clientProfileId, NOW);

		expect(result).toEqual({ opened: 0, updated: 0, resolved: 1 });
		expect(await snapshots.find(orgId, clientProfileId)).toBeNull();
		expect(wealth.all).toEqual([]);
		expect(await contacts.find(orgId, clientProfileId)).toBeNull();
		const left = await alertsOf(clientProfileId);
		expect(left.map((a) => [a.rule, a.status]).sort()).toEqual(
			[
				[AlertRule.Concentration, AlertStatus.Resolved],
				[AlertRule.Manual, AlertStatus.Open],
			].sort()
		);
	});

	it('purgeClient removes everything of the client, manual alerts included', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);
		await alerts.insertMany([manualAlert(clientProfileId)]);
		await contacts.record(orgId, clientProfileId, NOW, ADVISOR);

		await service.purgeClient(orgId, clientProfileId);

		expect(await snapshots.find(orgId, clientProfileId)).toBeNull();
		expect(wealth.all).toEqual([]);
		expect(await contacts.find(orgId, clientProfileId)).toBeNull();
		expect(await alertsOf(clientProfileId)).toEqual([]);
	});

	it('a failing source records the reason and leaves its alerts untouched', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);
		const before = await alertsOf(clientProfileId);
		jest
			.spyOn(metrics, 'computeForSystem')
			.mockRejectedValueOnce(new Error('ledger down'));

		const result = await service.recompute(orgId, clientProfileId, NOW);

		expect(result).toEqual({ opened: 0, updated: 0, resolved: 0 });
		expect(await alertsOf(clientProfileId)).toEqual(before);
		const snapshot = await snapshots.find(orgId, clientProfileId);
		expect(snapshot?.sources).toEqual([
			{
				source: SnapshotSource.AdvisorLedger,
				metrics: null,
				unavailableReason: SOURCE_METRICS_FAILED,
			},
		]);
		// A linha do dia que já existia fica; a falha não grava outra.
		expect(wealth.all).toHaveLength(1);
	});

	it('never writes an advisor.client.accessed audit', async () => {
		const shared = await sharingClient();
		const own = await advisorClient(400);
		await concentratedLedger(own.clientProfileId);
		audit.recorded.length = 0;

		await service.recompute(orgId, shared.clientProfileId, NOW);
		await service.recompute(orgId, own.clientProfileId, NOW);

		expect(
			audit.recorded.filter((e) => e.type === CLIENT_ACCESSED_EVENT)
		).toEqual([]);
	});
	/** ConsentService com a purga de verdade (este serviço) atrás da porta. */
	const erasingConsents = () =>
		new ConsentService(
			invites,
			consents,
			relationships,
			new RelationshipService(relationships),
			profiles,
			orgs,
			identity,
			source,
			audit,
			new RecordingSnapshotTrigger(),
			service,
			new RecordingRelationshipNotifier()
		);

	/** Segura a próxima leitura do livro até `release`. */
	const holdLedger = () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const original = metrics.computeForSystem.bind(metrics);
		let started!: () => void;
		const reached = new Promise<void>((r) => (started = r));
		jest
			.spyOn(metrics, 'computeForSystem')
			.mockImplementationOnce(async (...args) => {
				started();
				await gate;
				return original(...args);
			});
		return { release, reached };
	};

	const expectNothingLeft = async (clientProfileId: string) => {
		expect(await alertsOf(clientProfileId)).toEqual([]);
		expect(await snapshots.find(orgId, clientProfileId)).toBeNull();
		expect(
			wealth.all.filter((r) => r.clientProfileId === clientProfileId)
		).toEqual([]);
		expect(await contacts.find(orgId, clientProfileId)).toBeNull();
	};

	describe('R13: purge while a recompute is running', () => {
		it('a recompute that starts before the erasure and finishes after it leaves nothing', async () => {
			const { clientProfileId } = await sharingClient();
			await concentratedLedger(clientProfileId);
			await service.recompute(orgId, clientProfileId, NOW);
			await contacts.record(orgId, clientProfileId, NOW, ADVISOR);
			const held = holdLedger();

			const running = service.recompute(orgId, clientProfileId, NOW);
			await held.reached;
			await erasingConsents().eraseUser(INVESTOR, 'joao@exemplo.com');
			held.release();
			await running;

			await expectNothingLeft(clientProfileId);
		});

		it('a recompute that writes between the purge and the anonymization is purged by the second pass', async () => {
			const { clientProfileId } = await sharingClient();
			await concentratedLedger(clientProfileId);
			const held = holdLedger();
			const running = service.recompute(orgId, clientProfileId, NOW);
			await held.reached;
			const anonymize = profiles.anonymizeByOwner.bind(profiles);
			jest
				.spyOn(profiles, 'anonymizeByOwner')
				.mockImplementationOnce(async (userId: string) => {
					// O cálculo termina aqui: perfil ainda sem a marca de apagado.
					held.release();
					await running;
					expect((await alertsOf(clientProfileId)).length).toBeGreaterThan(0);
					return anonymize(userId);
				});

			await erasingConsents().eraseUser(INVESTOR, 'joao@exemplo.com');

			await expectNothingLeft(clientProfileId);
		});

		it('a plain revoke during a recompute only retires: manual alerts stay', async () => {
			const { clientProfileId, relationshipId } = await sharingClient();
			await concentratedLedger(clientProfileId);
			await alerts.insertMany([manualAlert(clientProfileId)]);
			const held = holdLedger();
			const running = service.recompute(orgId, clientProfileId, NOW);
			await held.reached;
			await erasingConsents().revoke(INVESTOR, relationshipId);
			held.release();
			await running;

			const left = await alertsOf(clientProfileId);
			expect(
				left.filter((a) => a.status === AlertStatus.Open).map((a) => a.rule)
			).toEqual([AlertRule.Manual]);
			expect(await snapshots.find(orgId, clientProfileId)).toBeNull();
			expect(wealth.all).toEqual([]);
		});

		it('a profile deleted during the recompute is purged', async () => {
			const { clientProfileId } = await advisorClient(400);
			await concentratedLedger(clientProfileId);
			const held = holdLedger();
			const running = service.recompute(orgId, clientProfileId, NOW);
			await held.reached;
			await profiles.deleteById(clientProfileId);
			held.release();
			await running;

			await expectNothingLeft(clientProfileId);
		});
	});

	it('R11: two shared portfolios with the same symbol over the limit open two alerts', async () => {
		petrPortfolio('p2');
		const { clientProfileId, relationshipId } = await sharingClient();
		await consentService.changeSharedPortfolios(INVESTOR, relationshipId, [
			'p1',
			'p2',
		]);

		await service.recompute(orgId, clientProfileId, NOW);

		const shared = (await alertsOf(clientProfileId)).filter(
			(a) => a.source === SnapshotSource.B2cShared
		);
		expect(shared.map((a) => [a.rule, a.portfolioId, a.key]).sort()).toEqual(
			[
				[AlertRule.Concentration, 'p1', 'PETR4'],
				[AlertRule.Concentration, 'p2', 'PETR4'],
			].sort()
		);
		expect(shared.map((a) => a.conditionKey).sort()).toEqual([
			'CONCENTRATION:B2C_SHARED/p1:PETR4',
			'CONCENTRATION:B2C_SHARED/p2:PETR4',
		]);
	});

	describe('R12: B2C rows follow the current consent', () => {
		const sharedRow = (clientProfileId: string, portfolioId: string) => ({
			orgId,
			clientProfileId,
			date: DAYS[DAYS.length - 3],
			source: SnapshotSource.B2cShared,
			portfolioId,
			totalMinor: 1,
			verifiedMinor: 1,
			manualMinor: 0,
		});

		it('drops rows of portfolios outside the consent, with no help from the previous snapshot', async () => {
			const { clientProfileId } = await sharingClient();
			await wealth.upsert(sharedRow(clientProfileId, 'p-old'));
			expect(await snapshots.find(orgId, clientProfileId)).toBeNull();

			await service.recompute(orgId, clientProfileId, NOW);

			expect(
				wealth.all
					.filter((r) => r.source === SnapshotSource.B2cShared)
					.map((r) => r.portfolioId)
			).toEqual(['p1']);
		});

		it('a failed B2C read keeps the rows of consented portfolios and its alerts, drops the rest', async () => {
			const { clientProfileId } = await sharingClient();
			await service.recompute(orgId, clientProfileId, NOW);
			const before = await alertsOf(clientProfileId);
			await wealth.upsert(sharedRow(clientProfileId, 'p-old'));
			jest.spyOn(source, 'read').mockRejectedValueOnce(new Error('down'));

			await service.recompute(orgId, clientProfileId, NOW);

			expect(
				wealth.all
					.filter((r) => r.source === SnapshotSource.B2cShared)
					.map((r) => [r.portfolioId, r.date])
			).toEqual([['p1', TODAY]]);
			expect(await alertsOf(clientProfileId)).toEqual(before);
			const snapshot = await snapshots.find(orgId, clientProfileId);
			expect(
				snapshot?.sources.find((s) => s.source === SnapshotSource.B2cShared)
			).toEqual({
				source: SnapshotSource.B2cShared,
				portfolioId: 'p1',
				metrics: null,
				unavailableReason: SOURCE_READ_FAILED,
			});
		});
	});

	it('Minor 6: an alert stored with another key order is not patched again', async () => {
		const { clientProfileId } = await advisorClient(400);
		await concentratedLedger(clientProfileId);
		await service.recompute(orgId, clientProfileId, NOW);
		const [alert] = await alertsOf(clientProfileId);
		const reversed = Object.fromEntries(
			Object.entries(alert.evidence).reverse()
		);
		await alerts.patch(alert.id, { evidence: reversed });

		expect(await service.recompute(orgId, clientProfileId, NOW)).toEqual({
			opened: 0,
			updated: 0,
			resolved: 0,
		});
	});
});
