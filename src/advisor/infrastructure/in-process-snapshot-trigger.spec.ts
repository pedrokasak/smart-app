import { Logger } from '@nestjs/common';
import type {
	ClientSnapshotService,
	RecomputeResult,
} from '../application/attention/client-snapshot.service';
import {
	InProcessSnapshotTrigger,
	SNAPSHOT_TRIGGER_CONCURRENCY,
} from './in-process-snapshot-trigger';

const DONE: RecomputeResult = { opened: 0, updated: 0, resolved: 0 };

/** Recompute controlável: cada chamada fica pendente até `release`. */
class FakeSnapshots {
	readonly calls: string[] = [];
	private readonly gates: Array<() => void> = [];
	inFlight = 0;
	maxInFlight = 0;
	failFor = new Set<string>();
	hold = false;

	recompute = async (
		orgId: string,
		clientProfileId: string
	): Promise<RecomputeResult> => {
		const key = `${orgId}:${clientProfileId}`;
		this.calls.push(key);
		this.inFlight += 1;
		this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
		try {
			if (this.hold) await new Promise<void>((r) => this.gates.push(r));
			else await new Promise((r) => setImmediate(r));
			if (this.failFor.has(key)) {
				throw new TypeError(`boom for joao@exemplo.com R$ 1.000`);
			}
			return DONE;
		} finally {
			this.inFlight -= 1;
		}
	};

	releaseAll(): void {
		this.hold = false;
		for (const release of this.gates.splice(0)) release();
	}
}

describe('InProcessSnapshotTrigger', () => {
	let snapshots: FakeSnapshots;
	let trigger: InProcessSnapshotTrigger;

	beforeEach(() => {
		snapshots = new FakeSnapshots();
		trigger = new InProcessSnapshotTrigger(
			snapshots as unknown as ClientSnapshotService
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('two equal requests in a row run one recompute', async () => {
		trigger.request('org-1', 'c-1');
		trigger.request('org-1', 'c-1');
		await trigger.whenIdle();

		expect(snapshots.calls).toEqual(['org-1:c-1']);
	});

	it('returns before the recompute starts (never blocks the caller)', () => {
		trigger.request('org-1', 'c-1');
		expect(snapshots.calls).toEqual([]);
		return trigger.whenIdle();
	});

	it('a request made while the same client runs waits and runs once more', async () => {
		snapshots.hold = true;
		trigger.request('org-1', 'c-1');
		await new Promise((r) => setImmediate(r));
		expect(snapshots.calls).toEqual(['org-1:c-1']);

		trigger.request('org-1', 'c-1');
		trigger.request('org-1', 'c-1');
		await new Promise((r) => setImmediate(r));
		expect(snapshots.inFlight).toBe(1);

		snapshots.releaseAll();
		await trigger.whenIdle();
		expect(snapshots.calls).toEqual(['org-1:c-1', 'org-1:c-1']);
	});

	it(`runs at most ${SNAPSHOT_TRIGGER_CONCURRENCY} at a time`, async () => {
		for (let i = 0; i < 10; i += 1) trigger.request('org-1', `c-${i}`);
		await trigger.whenIdle();

		expect(snapshots.calls).toHaveLength(10);
		expect(snapshots.maxInFlight).toBe(SNAPSHOT_TRIGGER_CONCURRENCY);
	});

	it('a failure in one client does not stop the others and logs only the error class', async () => {
		const logged = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);
		snapshots.failFor.add('org-1:c-2');

		expect(() => {
			trigger.request('org-1', 'c-1');
			trigger.request('org-1', 'c-2');
			trigger.request('org-1', 'c-3');
		}).not.toThrow();
		await trigger.whenIdle();

		expect(snapshots.calls.sort()).toEqual([
			'org-1:c-1',
			'org-1:c-2',
			'org-1:c-3',
		]);
		expect(logged).toHaveBeenCalledTimes(1);
		const message = String(logged.mock.calls[0][0]);
		expect(message).toContain('TypeError');
		expect(message).not.toMatch(/joao|R\$|boom|c-2/);
	});
});
