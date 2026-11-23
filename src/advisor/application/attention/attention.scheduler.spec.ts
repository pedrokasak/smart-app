import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import type { AgentGate } from 'src/agent-control/application/agent-gate.port';
import { collectAgentReport } from 'src/agent-control/application/agent-run-context';
import { findAgentDefinition } from 'src/agent-control/domain/agent-catalog';
import { AdvisorType, RelationshipStatus } from '../../domain/enums';
import {
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from '../in-memory-stores.fixture';
import {
	ATTENTION_JOB_CONCURRENCY,
	AttentionScheduler,
	settleWithConcurrency,
} from './attention.scheduler';
import type {
	ClientSnapshotService,
	RecomputeResult,
} from './client-snapshot.service';

class FakeSnapshots {
	readonly calls: string[] = [];
	readonly failFor = new Set<string>();
	inFlight = 0;
	maxInFlight = 0;

	recompute = async (
		orgId: string,
		clientProfileId: string,
		now: Date
	): Promise<RecomputeResult> => {
		expect(now).toBeInstanceOf(Date);
		this.calls.push(`${orgId}:${clientProfileId}`);
		this.inFlight += 1;
		this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
		try {
			await new Promise((r) => setImmediate(r));
			if (this.failFor.has(clientProfileId)) throw new Error('boom');
			return { opened: 1, updated: 2, resolved: 3 };
		} finally {
			this.inFlight -= 1;
		}
	};
}

describe('AttentionScheduler', () => {
	let orgs: InMemoryOrganizationStore;
	let relationships: InMemoryRelationshipStore;
	let snapshots: FakeSnapshots;
	let scheduler: AttentionScheduler;

	beforeEach(() => {
		orgs = new InMemoryOrganizationStore();
		relationships = new InMemoryRelationshipStore();
		snapshots = new FakeSnapshots();
		scheduler = new AttentionScheduler(
			orgs,
			relationships,
			snapshots as unknown as ClientSnapshotService
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	const org = async () =>
		(await orgs.create({ name: 'Org', advisorType: AdvisorType.Assessor })).id;

	it('the advisor-attention agent is in the catalog (boot fails without it)', () => {
		const definition = findAgentDefinition('advisor-attention');
		expect(definition).toMatchObject({
			kind: 'data_job',
			criticality: 'toggleable',
			defaultEnabled: true,
			schedule: 'dias úteis, 20h00',
			envKillSwitch: 'AGENT_ADVISOR_ATTENTION_ENABLED',
		});
		expect(definition!.seedEnabled({})).toBe(true);
	});

	it('runs on weekdays at 20h00 São Paulo', () => {
		expect(
			Reflect.getMetadata(
				SCHEDULE_CRON_OPTIONS,
				AttentionScheduler.prototype.run
			)
		).toMatchObject({
			cronTime: '0 20 * * 1-5',
			timeZone: 'America/Sao_Paulo',
		});
	});

	it('recomputes every ACTIVE client of every org and returns the counts', async () => {
		const a = await org();
		const b = await org();
		await relationships.create({
			orgId: a,
			clientProfileId: 'a1',
			status: RelationshipStatus.Active,
		});
		await relationships.create({
			orgId: a,
			clientProfileId: 'a2',
			status: RelationshipStatus.Revoked,
		});
		await relationships.create({
			orgId: a,
			clientProfileId: 'a3',
			status: RelationshipStatus.Pending,
		});
		await relationships.create({
			orgId: b,
			clientProfileId: 'b1',
			status: RelationshipStatus.Active,
		});

		const outcome = await collectAgentReport(() => scheduler.run());

		expect(snapshots.calls.sort()).toEqual([`${a}:a1`, `${b}:b1`].sort());
		expect(outcome).toMatchObject({
			kind: 'done',
			value: { clients: 2, failed: 0, opened: 2, updated: 4, resolved: 6 },
			report: { items: 2, errors: 0 },
		});
	});

	it('an error in one client does not stop the others', async () => {
		const a = await org();
		for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
			await relationships.create({
				orgId: a,
				clientProfileId: id,
				status: RelationshipStatus.Active,
			});
		}
		snapshots.failFor.add('c3');
		const logged = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);

		const outcome = await collectAgentReport(() => scheduler.run());

		expect(snapshots.calls).toHaveLength(6);
		expect(snapshots.maxInFlight).toBeLessThanOrEqual(
			ATTENTION_JOB_CONCURRENCY
		);
		expect(outcome).toMatchObject({
			kind: 'done',
			value: { clients: 5, failed: 1 },
			report: { items: 5, errors: 1 },
		});
		expect(String(logged.mock.calls[0][0])).not.toContain('boom');
	});

	it('an org that fails to list is isolated too', async () => {
		const a = await org();
		const b = await org();
		await relationships.create({
			orgId: b,
			clientProfileId: 'b1',
			status: RelationshipStatus.Active,
		});
		const original = relationships.listByOrg.bind(relationships);
		jest
			.spyOn(relationships, 'listByOrg')
			.mockImplementation(async (orgId, query) => {
				if (orgId === a) throw new Error('down');
				return original(orgId, query);
			});
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		const counts = await scheduler.run();

		expect(snapshots.calls).toEqual([`${b}:b1`]);
		expect(counts).toMatchObject({ clients: 1, failed: 1 });
	});

	it('skips the run when the panel turned the agent off', async () => {
		const a = await org();
		await relationships.create({
			orgId: a,
			clientProfileId: 'a1',
			status: RelationshipStatus.Active,
		});
		const gate = {
			run: jest.fn(async () => undefined),
		} as unknown as AgentGate;
		const gated = new AttentionScheduler(
			orgs,
			relationships,
			snapshots as unknown as ClientSnapshotService,
			gate
		);

		await gated.run();

		expect(gate.run).toHaveBeenCalledWith(
			'advisor-attention',
			expect.any(Function)
		);
		expect(snapshots.calls).toEqual([]);
	});
});

describe('settleWithConcurrency', () => {
	it('keeps the order, isolates failures and respects the limit', async () => {
		let inFlight = 0;
		let max = 0;
		const results = await settleWithConcurrency(
			[1, 2, 3, 4, 5],
			2,
			async (n) => {
				inFlight += 1;
				max = Math.max(max, inFlight);
				await new Promise((r) => setImmediate(r));
				inFlight -= 1;
				if (n === 3) throw new Error('three');
				return n * 10;
			}
		);

		expect(max).toBe(2);
		expect(results.map((r) => r.status)).toEqual([
			'fulfilled',
			'fulfilled',
			'rejected',
			'fulfilled',
			'fulfilled',
		]);
		expect(
			results.map((r) => (r.status === 'fulfilled' ? r.value : null))
		).toEqual([10, 20, null, 40, 50]);
	});

	it('turns a synchronous throw into a rejected result', async () => {
		const results = await settleWithConcurrency([1], 4, () => {
			throw new Error('sync');
		});
		expect(results[0].status).toBe('rejected');
	});
});
