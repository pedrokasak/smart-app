import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AdvisorType,
	AssetClass,
	OrgRole,
	ProfileOrigin,
	Provenance,
	RelationshipStatus,
	TransactionSide,
} from '../domain/enums';
import {
	AuthorizationService,
	CLIENT_ACCESSED_EVENT,
} from './authorization.service';
import { ClientNotAccessibleError } from './access-errors';
import { ConsentService } from './consent.service';
import {
	InMemoryAssignmentStore,
	InMemoryBenchmarkSeries,
	InMemoryClientProfileStore,
	InMemoryConsentStore,
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryInviteeIdentity,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPriceHistory,
	InMemoryRelationshipStore,
	InMemorySharedPortfolioSource,
	RecordingAttentionPurge,
	RecordingSnapshotTrigger,
} from './in-memory-stores.fixture';
import { InviteService } from './invite.service';
import { isTradingDay } from './metrics/portfolio-math';
import type { DailyCloseMinor } from './ports/price-history.port';
import type { SharedTrade } from './ports/shared-portfolio-source.port';
import { RelationshipService } from './relationship.service';
import {
	NoActiveConsentError,
	SharedPortfolioService,
} from './shared-portfolio.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];

	async record(event: AuditEventInput): Promise<void> {
		this.recorded.push(event);
	}

	get views(): AuditEventInput[] {
		return this.recorded.filter(
			(e) =>
				e.type === CLIENT_ACCESSED_EVENT &&
				(e.payload as { action?: string }).action === 'VIEW_PORTFOLIO'
		);
	}
}

const TODAY = '2025-06-17';
const INVESTOR = 'inv-1';

const addDay = (iso: string): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

const tradingDaysBetween = (from: string, to: string): string[] => {
	const days: string[] = [];
	for (let day = from; day <= to; day = addDay(day)) {
		if (isTradingDay(day)) days.push(day);
	}
	return days;
};

const DAYS = tradingDaysBetween('2025-05-05', TODAY);
const rising = (startMinor: number): DailyCloseMinor[] =>
	DAYS.map((date, i) => ({
		date,
		closeMinor: Math.round(startMinor * 1.002 ** i),
	}));

const trade = (over: Partial<SharedTrade> = {}): SharedTrade => ({
	symbol: 'PETR4',
	assetClass: AssetClass.Stock,
	side: TransactionSide.Buy,
	quantity: 10,
	unitPriceMinor: 3000,
	feesMinor: 0,
	tradeDate: DAYS[0],
	provenance: Provenance.Verified,
	createdAt: new Date('2025-05-05T12:00:00.000Z'),
	...over,
});

describe('SharedPortfolioService', () => {
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let consents: InMemoryConsentStore;
	let source: InMemorySharedPortfolioSource;
	let prices: InMemoryPriceHistory;
	let benchmarks: InMemoryBenchmarkSeries;
	let audit: FakeAuditTrail;
	let consentService: ConsentService;
	let service: SharedPortfolioService;
	let ctxA: { userId: string; orgId: string };
	let ctxB: { userId: string; orgId: string };
	let clientProfileId: string;
	let assignments: InMemoryAssignmentStore;
	let relationshipId: string;

	beforeAll(() => {
		jest.useFakeTimers({
			now: new Date(`${TODAY}T15:00:00.000Z`),
			doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
		});
	});

	afterAll(() => {
		jest.useRealTimers();
	});

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		const orgs = new InMemoryOrganizationStore();
		const invites = new InMemoryInviteStore();
		const notifier = new InMemoryInviteNotifier();
		const identity = new InMemoryInviteeIdentity();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		profiles = new InMemoryClientProfileStore();
		consents = new InMemoryConsentStore();
		source = new InMemorySharedPortfolioSource();
		prices = new InMemoryPriceHistory();
		benchmarks = new InMemoryBenchmarkSeries();
		audit = new FakeAuditTrail();

		const orgA = await orgs.create({
			name: 'Org A',
			advisorType: AdvisorType.Consultor,
		});
		const orgB = await orgs.create({
			name: 'Org B',
			advisorType: AdvisorType.Assessor,
		});
		ctxA = { userId: 'adv-1', orgId: orgA.id };
		ctxB = { userId: 'adv-2', orgId: orgB.id };
		await memberships.create({
			userId: ctxA.userId,
			orgId: orgA.id,
			role: OrgRole.Advisor,
		});
		await memberships.create({
			userId: ctxB.userId,
			orgId: orgB.id,
			role: OrgRole.Advisor,
		});
		identity.set(INVESTOR, {
			email: 'joao@exemplo.com',
			emailVerified: true,
		});

		source.add(INVESTOR, {
			id: 'p1',
			name: 'Principal',
			holdings: [
				{
					symbol: 'PETR4',
					assetClass: AssetClass.Stock,
					quantity: 10,
					costMinor: 30000,
					provenance: Provenance.Verified,
				},
			],
			trades: [trade()],
		});
		source.add(INVESTOR, {
			id: 'p2',
			name: 'Aposentadoria',
			holdings: [
				{
					symbol: 'VALE3',
					assetClass: AssetClass.Stock,
					quantity: 20,
					costMinor: 120000,
					provenance: Provenance.Manual,
				},
				{
					symbol: 'CDB-X',
					assetClass: AssetClass.FixedIncome,
					quantity: 1,
					costMinor: 500000,
					provenance: Provenance.Manual,
				},
			],
		});
		prices.set('PETR4', rising(3000));
		prices.set('VALE3', rising(6000));
		benchmarks.set('CDI', 0.01);
		benchmarks.set('IBOV', 0.02);
		benchmarks.set('IPCA', 0.004);

		const relationshipService = new RelationshipService(relationships);
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		const inviteService = new InviteService(
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
			new RecordingAttentionPurge()
		);
		service = new SharedPortfolioService(
			authz,
			relationships,
			consents,
			profiles,
			source,
			prices,
			benchmarks
		);

		const created = await inviteService.createInvite(ctxA, {
			email: 'joao@exemplo.com',
			clientName: 'Joao Silva',
		});
		const grant = await consentService.acceptInvite(
			INVESTOR,
			notifier.sent[notifier.sent.length - 1].token,
			['p1', 'p2']
		);
		clientProfileId = created.clientProfileId;
		relationshipId = grant.relationshipId;
		audit.recorded.length = 0;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('nega ao ADVISOR desatribuído na chamada seguinte, sem auditar nem ler a fonte', async () => {
		await service.getSharedMetrics(ctxA, clientProfileId);
		audit.recorded.length = 0;
		await assignments.unassign(ctxA.orgId, clientProfileId, ctxA.userId);
		const read = jest.spyOn(source, 'read');

		await expect(
			service.getSharedMetrics(ctxA, clientProfileId)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
		expect(read).not.toHaveBeenCalled();
	});

	it('returns each consented portfolio with its own metrics and audits once', async () => {
		const result = await service.getSharedMetrics(ctxA, clientProfileId);

		expect(result.map((r) => [r.portfolioId, r.name])).toEqual([
			['p1', 'Principal'],
			['p2', 'Aposentadoria'],
		]);
		const [p1, p2] = result;
		expect(p1.metrics.positions.map((p) => p.symbol)).toEqual(['PETR4']);
		expect(p1.metrics.performance.unavailable).toBeNull();
		expect(p1.metrics.performance.coveragePct).toBe(100);
		expect(p1.metrics.allocation.target).toBeNull();
		expect(p1.metrics.benchmarks.map((b) => b.periodReturn)).toEqual([
			0.01, 0.02, 0.004,
		]);
		expect(p1.unreconciledSymbols).toEqual([]);

		expect(p2.metrics.positions.map((p) => p.symbol).sort()).toEqual([
			'CDB-X',
			'VALE3',
		]);
		const vale = p2.metrics.positions.find((p) => p.symbol === 'VALE3');
		expect(vale.priced).toBe(true);
		expect(vale.marketValueMinor).toBe(20 * rising(6000).at(-1).closeMinor);
		expect(p2.metrics.performance.unavailable).toBe('NO_TRANSACTIONS');
		expect(p2.metrics.performance.coveragePct).toBe(0);
		expect(p2.metrics.warnings.noHistorySymbols).toEqual(['CDB-X', 'VALE3']);
		expect(p2.metrics.warnings.unpricedSymbols).toEqual(['CDB-X']);

		expect(prices.calls.map((c) => c.symbol).sort()).toEqual([
			'PETR4',
			'VALE3',
		]);
		expect(audit.views).toHaveLength(1);
	});

	it('refuses after the investor revokes, without reading the portfolios', async () => {
		const read = jest.spyOn(source, 'read');
		await consentService.revoke(INVESTOR, relationshipId);

		await expect(
			service.getSharedMetrics(ctxA, clientProfileId)
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(
			service.listSharedPortfolios(ctxA, clientProfileId)
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(read).not.toHaveBeenCalled();
		expect(prices.calls).toHaveLength(0);
	});

	it('follows a scope change on the next call', async () => {
		await service.getSharedMetrics(ctxA, clientProfileId);
		await consentService.changeSharedPortfolios(INVESTOR, relationshipId, [
			'p1',
		]);

		const result = await service.getSharedMetrics(ctxA, clientProfileId);
		const listed = await service.listSharedPortfolios(ctxA, clientProfileId);

		expect(result.map((r) => r.portfolioId)).toEqual(['p1']);
		expect(listed).toEqual([{ id: 'p1', name: 'Principal' }]);
	});

	it('reads the source as the profile owner with exactly the consented ids', async () => {
		const read = jest.spyOn(source, 'read');

		await service.getSharedMetrics(ctxA, clientProfileId);

		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(INVESTOR, ['p1', 'p2']);
	});

	it('lists the consented portfolios by name', async () => {
		source.add(INVESTOR, { id: 'p3', name: 'Fora do consentimento' });

		await expect(
			service.listSharedPortfolios(ctxA, clientProfileId)
		).resolves.toEqual([
			{ id: 'p1', name: 'Principal' },
			{ id: 'p2', name: 'Aposentadoria' },
		]);
	});

	it('omits a consented portfolio the source no longer returns', async () => {
		const original = source.read.bind(source);
		jest
			.spyOn(source, 'read')
			.mockImplementation((userId: string, ids: string[]) =>
				original(
					userId,
					ids.filter((id) => id !== 'p2')
				)
			);

		const result = await service.getSharedMetrics(ctxA, clientProfileId);

		expect(result.map((r) => r.portfolioId)).toEqual(['p1']);
	});

	it('refuses another org without calling source, prices or benchmarks', async () => {
		const read = jest.spyOn(source, 'read');
		const listOwned = jest.spyOn(source, 'listOwned');

		await expect(
			service.getSharedMetrics(ctxB, clientProfileId)
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(
			service.listSharedPortfolios(ctxB, clientProfileId)
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(read).not.toHaveBeenCalled();
		expect(listOwned).not.toHaveBeenCalled();
		expect(prices.calls).toHaveLength(0);
		expect(benchmarks.calls).toHaveLength(0);
	});

	it('refuses an advisor-created profile with an active relationship', async () => {
		const profile = await profiles.create({
			orgId: ctxA.orgId,
			name: 'Cliente manual',
			origin: ProfileOrigin.AdvisorCreated,
		});
		await new RelationshipService(relationships).create(ctxA.orgId, profile.id);
		await assignments.assign(ctxA.orgId, profile.id, ctxA.userId, ctxA.userId);
		const read = jest.spyOn(source, 'read');

		await expect(
			service.getSharedMetrics(ctxA, profile.id)
		).rejects.toBeInstanceOf(NoActiveConsentError);
		await expect(
			service.listSharedPortfolios(ctxA, profile.id)
		).rejects.toBeInstanceOf(NoActiveConsentError);
		expect(read).not.toHaveBeenCalled();
	});

	describe('consent gate', () => {
		const expectRefusedWithoutSource = async () => {
			const read = jest.spyOn(source, 'read');
			const listOwned = jest.spyOn(source, 'listOwned');
			await expect(
				service.getSharedMetrics(ctxA, clientProfileId)
			).rejects.toBeInstanceOf(NoActiveConsentError);
			await expect(
				service.listSharedPortfolios(ctxA, clientProfileId)
			).rejects.toBeInstanceOf(NoActiveConsentError);
			expect(read).not.toHaveBeenCalled();
			expect(listOwned).not.toHaveBeenCalled();
			expect(prices.calls).toHaveLength(0);
		};

		it('refuses when the profile owner is not the consent holder', async () => {
			const profile = await profiles.findById(clientProfileId);
			jest
				.spyOn(profiles, 'findById')
				.mockResolvedValue({ ...profile, ownerUserId: 'someone-else' });

			await expectRefusedWithoutSource();
		});

		it('refuses a consent of another org or another client profile', async () => {
			const consent = await consents.findActiveByRelationship(relationshipId);
			for (const mismatch of [
				{ orgId: ctxB.orgId },
				{ clientProfileId: 'other-profile' },
			]) {
				jest
					.spyOn(consents, 'findActiveByRelationship')
					.mockResolvedValue({ ...consent, ...mismatch });

				await expectRefusedWithoutSource();
				jest.restoreAllMocks();
			}
		});

		it('refuses a relationship that is not ACTIVE even past the access check', async () => {
			jest
				.spyOn(AuthorizationService.prototype, 'ensureCanAccessClient')
				.mockResolvedValue(undefined);
			const relationship = await relationships.findById(relationshipId);
			for (const status of [
				RelationshipStatus.Pending,
				RelationshipStatus.Revoked,
			]) {
				await relationships.save({ ...relationship, status });

				await expectRefusedWithoutSource();
			}
		});
	});

	describe('getSharedMetricsForSystem', () => {
		it('computes the same metrics with no user context and no audit', async () => {
			const authorize = jest.spyOn(
				AuthorizationService.prototype,
				'ensureCanAccessClient'
			);
			const viaAdvisor = await service.getSharedMetrics(ctxA, clientProfileId);
			audit.recorded.length = 0;
			authorize.mockClear();

			const viaSystem = await service.getSharedMetricsForSystem(
				ctxA.orgId,
				clientProfileId
			);

			expect(viaSystem).toEqual(
				viaAdvisor.map((p) => ({
					portfolioId: p.portfolioId,
					metrics: p.metrics,
				}))
			);
			expect(audit.recorded).toHaveLength(0);
			expect(authorize).not.toHaveBeenCalled();
		});

		it('keeps the consent checks: revoked, other org and inactive relationship are refused', async () => {
			await expect(
				service.getSharedMetricsForSystem(ctxB.orgId, clientProfileId)
			).rejects.toBeInstanceOf(NoActiveConsentError);

			const relationship = await relationships.findById(relationshipId);
			await relationships.save({
				...relationship,
				status: RelationshipStatus.Pending,
			});
			await expect(
				service.getSharedMetricsForSystem(ctxA.orgId, clientProfileId)
			).rejects.toBeInstanceOf(NoActiveConsentError);
			await relationships.save(relationship);

			await consentService.revoke(INVESTOR, relationshipId);
			await expect(
				service.getSharedMetricsForSystem(ctxA.orgId, clientProfileId)
			).rejects.toBeInstanceOf(NoActiveConsentError);
			expect(audit.views).toHaveLength(0);
		});

		it('a failed B2C read returns every consented portfolio with SOURCE_READ_FAILED', async () => {
			jest.spyOn(source, 'read').mockRejectedValue(new Error('source down'));

			await expect(
				service.getSharedMetricsForSystem(ctxA.orgId, clientProfileId)
			).resolves.toEqual([
				{
					portfolioId: 'p1',
					metrics: null,
					unavailableReason: 'SOURCE_READ_FAILED',
				},
				{
					portfolioId: 'p2',
					metrics: null,
					unavailableReason: 'SOURCE_READ_FAILED',
				},
			]);
		});

		it('turns one failing portfolio into metrics null and keeps the others', async () => {
			const internals = service as unknown as {
				metricsOf: (
					portfolio: { portfolioId: string },
					...rest: unknown[]
				) => Promise<unknown>;
			};
			const original = internals.metricsOf.bind(service);
			jest
				.spyOn(internals, 'metricsOf')
				.mockImplementation(async (portfolio, ...rest) => {
					if (portfolio.portfolioId === 'p2') throw new Error('boom');
					return original(portfolio, ...rest);
				});

			const result = await service.getSharedMetricsForSystem(
				ctxA.orgId,
				clientProfileId
			);

			expect(result.map((p) => p.portfolioId)).toEqual(['p1', 'p2']);
			expect(result[0].metrics).not.toBeNull();
			expect(result[1]).toEqual({
				portfolioId: 'p2',
				metrics: null,
				unavailableReason: 'METRICS_FAILED',
			});
		});
	});

	it('lets a source failure surface instead of an empty list', async () => {
		jest.spyOn(source, 'read').mockRejectedValue(new Error('source down'));

		await expect(
			service.getSharedMetrics(ctxA, clientProfileId)
		).rejects.toThrow('source down');
	});

	it('never words anything as a recommendation', async () => {
		const result = await service.getSharedMetrics(ctxA, clientProfileId);

		expect(JSON.stringify(result)).not.toMatch(
			/recomend|sugest|deveria|comprar|vender|aportar/i
		);
	});
});
