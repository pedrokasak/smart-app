import {
	loadRiWatchConfig,
	RI_WATCH_DEFAULTS,
} from 'src/ri-intelligence/watch/application/ri-watch.config';

describe('loadRiWatchConfig (TRA-240)', () => {
	it('is off by default', () => {
		expect(loadRiWatchConfig({})).toEqual(RI_WATCH_DEFAULTS);
		expect(RI_WATCH_DEFAULTS.enabled).toBe(false);
	});

	it('reads the environment', () => {
		expect(
			loadRiWatchConfig({
				RI_WATCH_ENABLED: 'true',
				RI_WATCH_LOOKBACK_DAYS: '14',
				RI_WATCH_MAX_SUMMARIES_PER_RUN: '8',
			})
		).toEqual({ enabled: true, lookbackDays: 14, maxSummariesPerRun: 8 });
	});

	// O IPE da CVM e semanal: janela menor que a semana perde documento.
	it('never looks back less than a week plus margin', () => {
		expect(RI_WATCH_DEFAULTS.lookbackDays).toBeGreaterThanOrEqual(8);
		expect(
			loadRiWatchConfig({ RI_WATCH_LOOKBACK_DAYS: '3' }).lookbackDays
		).toBe(RI_WATCH_DEFAULTS.lookbackDays);
	});

	it('falls back per field on invalid values', () => {
		expect(
			loadRiWatchConfig({
				RI_WATCH_ENABLED: 'yes',
				RI_WATCH_LOOKBACK_DAYS: '90',
				RI_WATCH_MAX_SUMMARIES_PER_RUN: 'abc',
			})
		).toEqual(RI_WATCH_DEFAULTS);
	});

	it('accepts zero summaries per run as a cost kill switch', () => {
		expect(
			loadRiWatchConfig({ RI_WATCH_MAX_SUMMARIES_PER_RUN: '0' })
				.maxSummariesPerRun
		).toBe(0);
	});
});
