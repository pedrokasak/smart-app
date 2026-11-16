import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AssetClass,
	OrgRole,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../../domain/enums';
import { NewTransaction } from '../../domain/portfolio.entities';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryAllocationTargetStore,
	InMemoryBenchmarkSeries,
	InMemoryMembershipStore,
	InMemoryPriceHistory,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from '../in-memory-stores.fixture';
import type { DailyCloseMinor } from '../ports/price-history.port';
import { RelationshipService } from '../relationship.service';
import { isTradingDay } from './portfolio-math';
import { PortfolioMetricsService } from './portfolio-metrics.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];

	async record(event: AuditEventInput): Promise<void> {
		this.recorded.push(event);
	}
}

const TODAY = '2025-06-17';

const addDay = (iso: string): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

/** Pregões de `from` até `to`, inclusive. */
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

const newTx = (over: Partial<NewTransaction> = {}): NewTransaction => ({
	orgId: 'orgA',
	clientProfileId: 'client-1',
	symbol: 'PETR4',
	assetClass: AssetClass.Stock,
	side: TransactionSide.Buy,
	quantity: 10,
	unitPriceMinor: 10000,
	feesMinor: 0,
	currency: 'BRL',
	tradeDate: DAYS[0],
	provenance: Provenance.Verified,
	source: TransactionSource.CsvImport,
	createdByUserId: 'user-1',
	...over,
});

describe('PortfolioMetricsService', () => {
	const userId = 'user-1';
	const ctxA = { userId, orgId: 'orgA' };
	const ctxB = { userId, orgId: 'orgB' };
	let relationships: InMemoryRelationshipStore;
	let transactions: InMemoryTransactionStore;
	let targets: InMemoryAllocationTargetStore;
	let prices: InMemoryPriceHistory;
	let benchmarks: InMemoryBenchmarkSeries;
	let audit: FakeAuditTrail;
	let service: PortfolioMetricsService;

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
		relationships = new InMemoryRelationshipStore();
		transactions = new InMemoryTransactionStore();
		targets = new InMemoryAllocationTargetStore();
		prices = new InMemoryPriceHistory();
		benchmarks = new InMemoryBenchmarkSeries();
		audit = new FakeAuditTrail();
		const authz = new AuthorizationService(memberships, relationships, audit);
		service = new PortfolioMetricsService(
			authz,
			transactions,
			targets,
			prices,
			benchmarks
		);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
		await memberships.create({ userId, orgId: 'orgB', role: OrgRole.Advisor });
		const rel = new RelationshipService(relationships);
		await rel.create('orgA', 'client-1');
		await rel.create('orgB', 'client-1');

		prices.set('PETR4', rising(3000));
		prices.set('VALE3', rising(6000));
		benchmarks.set('CDI', 0.01);
		benchmarks.set('IBOV', 0.02);
		benchmarks.set('IPCA', 0.004);
	});

	it('returns the metrics and audits VIEW_PORTFOLIO once', async () => {
		await transactions.createMany([newTx(), newTx({ symbol: 'VALE3' })]);
		await targets.upsert({
			orgId: 'orgA',
			clientProfileId: 'client-1',
			targets: { [AssetClass.Stock]: 100 },
			updatedByUserId: userId,
		});

		const m = await service.getMetrics(ctxA, 'client-1');

		expect(m.asOf).toBe(TODAY);
		expect(m.positions.map((p) => p.symbol).sort()).toEqual(['PETR4', 'VALE3']);
		expect(m.performance.unavailable).toBeNull();
		expect(m.allocation.driftPp).not.toBeNull();
		expect(m.benchmarks.map((b) => b.periodReturn)).toEqual([
			0.01, 0.02, 0.004,
		]);
		expect(prices.calls.map((c) => c.symbol).sort()).toEqual([
			'PETR4',
			'VALE3',
		]);
		expect(prices.calls[0]).toMatchObject({ from: DAYS[0], to: TODAY });
		expect(benchmarks.calls[0]).toMatchObject({
			from: m.performance.measuredFrom,
			to: m.performance.measuredTo,
		});
		expect(audit.recorded).toHaveLength(1);
		expect(audit.recorded[0].payload).toMatchObject({
			action: 'VIEW_PORTFOLIO',
		});
	});

	it('refuses another org without calling any port', async () => {
		await transactions.createMany([newTx()]);
		const error = await service
			.getMetrics({ userId, orgId: 'orgC' }, 'client-1')
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ForbiddenException);
		expect(prices.calls).toHaveLength(0);
		expect(benchmarks.calls).toHaveLength(0);
	});

	it('refuses a revoked relationship without calling any port', async () => {
		await transactions.createMany([newTx()]);
		const active = await relationships.findByOrgAndClient('orgA', 'client-1');
		await new RelationshipService(relationships).revoke(active.id);

		await expect(service.getMetrics(ctxA, 'client-1')).rejects.toBeInstanceOf(
			ForbiddenException
		);
		expect(prices.calls).toHaveLength(0);
		expect(benchmarks.calls).toHaveLength(0);
	});

	it('leaves a symbol unpriced when its price lookup rejects', async () => {
		await transactions.createMany([newTx(), newTx({ symbol: 'VALE3' })]);
		prices.failFor('VALE3');

		const m = await service.getMetrics(ctxA, 'client-1');

		expect(m.warnings.unpricedSymbols).toEqual(['VALE3']);
		expect(m.positions.find((p) => p.symbol === 'PETR4').priced).toBe(true);
	});

	it('nulls only the benchmark whose lookup rejects', async () => {
		await transactions.createMany([newTx()]);
		benchmarks.failFor('IBOV');

		const m = await service.getMetrics(ctxA, 'client-1');

		expect(m.benchmarks).toEqual([
			expect.objectContaining({ key: 'CDI', periodReturn: 0.01 }),
			{ key: 'IBOV', periodReturn: null, excess: null },
			expect.objectContaining({ key: 'IPCA', periodReturn: 0.004 }),
		]);
	});

	it('fetches no benchmark for an inconsistent ledger', async () => {
		await transactions.createMany([
			newTx(),
			newTx({ side: TransactionSide.Sell, quantity: 15, tradeDate: DAYS[3] }),
		]);

		const m = await service.getMetrics(ctxA, 'client-1');

		expect(m.performance.unavailable).toBe('INCONSISTENT_LEDGER');
		expect(benchmarks.calls).toHaveLength(0);
		expect(m.benchmarks.map((b) => b.periodReturn)).toEqual([null, null, null]);
	});

	it('never asks the price port for FIXED_INCOME or OTHER', async () => {
		await transactions.createMany([
			newTx(),
			newTx({
				symbol: 'CDB-X',
				assetClass: AssetClass.FixedIncome,
				unitPriceMinor: 100000,
				quantity: 1,
			}),
			newTx({
				symbol: 'COE-Y',
				assetClass: AssetClass.Other,
				unitPriceMinor: 50000,
				quantity: 1,
			}),
		]);

		const m = await service.getMetrics(ctxA, 'client-1');

		expect(prices.calls.map((c) => c.symbol)).toEqual(['PETR4']);
		expect(m.warnings.unpricedSymbols).toEqual(['CDB-X', 'COE-Y']);
	});

	it('runs at most 5 price lookups at a time', async () => {
		const symbols = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
		await transactions.createMany(symbols.map((symbol) => newTx({ symbol })));
		for (const symbol of symbols) prices.set(symbol, rising(1000));

		await service.getMetrics(ctxA, 'client-1');

		expect(prices.calls).toHaveLength(8);
		expect(prices.maxInFlight).toBeLessThanOrEqual(5);
		expect(prices.maxInFlight).toBeGreaterThan(1);
	});

	it('keeps each org on its own ledger for the same client', async () => {
		await transactions.createMany([
			newTx(),
			newTx({ orgId: 'orgB', symbol: 'VALE3', quantity: 3 }),
		]);

		const a = await service.getMetrics(ctxA, 'client-1');
		const b = await service.getMetrics(ctxB, 'client-1');

		expect(a.positions.map((p) => p.symbol)).toEqual(['PETR4']);
		expect(b.positions.map((p) => p.symbol)).toEqual(['VALE3']);
		expect(b.positions[0].quantity).toBe(3);
	});
});
