import { RiWatchMetricsSnapshot } from 'src/ri-intelligence/watch/application/ports/ri-watch-metrics.port';
import {
	DEFAULT_COST_PER_1K_TOKENS_USD,
	loadCostPer1kTokensUsd,
	RI_WATCH_METRICS_WINDOW_DAYS,
	RiWatchMetricsService,
} from 'src/ri-intelligence/watch/application/ri-watch-metrics.service';
import { RI_WATCH_DEFAULTS } from 'src/ri-intelligence/watch/application/ri-watch.config';

const NOW = new Date('2026-10-03T15:00:00.000Z');

const COUNTS = {
	discovered: 0,
	summarized: 0,
	skipped: 0,
	failed: 0,
	notified: 0,
	indexed: 0,
};

const SNAPSHOT: RiWatchMetricsSnapshot = {
	queue: { pending: 2, awaitingNotification: 1, awaitingIndex: 3 },
	totals: { ...COUNTS, discovered: 40, summarized: 30 },
	window: { ...COUNTS, discovered: 12, summarized: 9, failed: 1 },
	failureReasons: [{ reason: 'content_empty_after_extract', count: 2 }],
	recentFailures: [],
	usage: { aiCalls: 9, tokens: 48_000 },
};

describe('RiWatchMetricsService (TRA-267)', () => {
	it('reads the last 30 days and estimates the cost from the tokens', async () => {
		const reader = { read: jest.fn().mockResolvedValue(SNAPSHOT) };
		const service = new RiWatchMetricsService(
			reader,
			{ ...RI_WATCH_DEFAULTS, enabled: true, notifyEnabled: true },
			0.0005
		);

		const overview = await service.overview(NOW);

		const [since] = reader.read.mock.calls[0];
		expect(NOW.getTime() - since.getTime()).toBe(
			RI_WATCH_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
		);
		expect(overview.cost).toEqual({
			aiCalls: 9,
			tokens: 48_000,
			estimatedUsd: 0.024,
			pricePer1kTokensUsd: 0.0005,
		});
		expect(overview.window.summarized).toBe(9);
		expect(overview.generatedAt).toBe(NOW.toISOString());
	});

	// Fila parada com o aviso desligado nao e defeito: o painel mostra.
	it('shows which switches are on', async () => {
		const service = new RiWatchMetricsService(
			{ read: jest.fn().mockResolvedValue(SNAPSHOT) },
			{ ...RI_WATCH_DEFAULTS, enabled: true, indexEnabled: true },
			0.0005
		);

		const { switches } = await service.overview(NOW);

		expect(switches).toEqual({
			enabled: true,
			dailyFeed: true,
			fii: false,
			notify: false,
			index: true,
			maxSummariesPerRun: RI_WATCH_DEFAULTS.maxSummariesPerRun,
		});
	});
});

describe('loadCostPer1kTokensUsd (TRA-267)', () => {
	it('reads the price from the environment', () => {
		expect(
			loadCostPer1kTokensUsd({ RI_WATCH_COST_PER_1K_TOKENS_USD: '0.002' })
		).toBe(0.002);
	});

	it.each([undefined, '', 'abc', '-1', '5'])(
		'falls back to the default on %p',
		(value) => {
			expect(
				loadCostPer1kTokensUsd({ RI_WATCH_COST_PER_1K_TOKENS_USD: value })
			).toBe(DEFAULT_COST_PER_1K_TOKENS_USD);
		}
	);
});
