import { DAILY_CLOSES_DEFAULTS } from './daily-closes.config';
import { DailyClosesJobService } from './daily-closes-job.service';

function build(
	overrides: { ingest?: jest.Mock; betas?: jest.Mock; enabled?: boolean } = {}
) {
	const ingest = {
		run:
			overrides.ingest ?? jest.fn().mockResolvedValue({ days: [], years: [] }),
	};
	const betas = { refresh: overrides.betas ?? jest.fn().mockResolvedValue(3) };
	const store = {
		count: jest.fn().mockResolvedValue(1200),
		latestDate: jest.fn().mockResolvedValue('2026-10-06'),
	};
	const job = new DailyClosesJobService(
		ingest as any,
		betas as any,
		store as any,
		{ ...DAILY_CLOSES_DEFAULTS, enabled: overrides.enabled ?? false }
	);
	return { job, ingest, betas };
}

describe('DailyClosesJobService (TRA-251)', () => {
	it('baixa e recalcula os betas, e guarda o resultado da rodada', async () => {
		const { job } = build();

		const run = await job.run();

		expect(run?.error).toBeNull();
		expect(run?.report).toEqual({ days: [], years: [], betasUpdated: 3 });
		expect(run?.finishedAt).not.toBeNull();
		expect((await job.overview()).lastRun).toBe(run);
	});

	it('uma rodada por vez: a segunda enquanto roda é recusada', async () => {
		let release: () => void = () => undefined;
		const ingest = jest.fn(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ days: [], years: [] });
				})
		);
		const { job } = build({ ingest });

		const first = job.run();
		expect(job.isRunning).toBe(true);
		expect(await job.run()).toBeNull();

		release();
		await first;
		expect(job.isRunning).toBe(false);
	});

	it('falha não derruba o processo: vira erro na rodada e libera a próxima', async () => {
		const { job } = build({
			ingest: jest.fn().mockRejectedValue(new Error('B3 fora do ar')),
		});

		const run = await job.run();

		expect(run?.error).toBe('B3 fora do ar');
		expect(run?.report).toBeNull();
		expect(job.isRunning).toBe(false);
	});

	it('o resumo mostra o relógio, a contagem e o último pregão guardado', async () => {
		const { job } = build({ enabled: true });

		expect(await job.overview()).toEqual({
			scheduled: true,
			running: false,
			rows: 1200,
			latestDate: '2026-10-06',
			lastRun: null,
		});
	});
});
