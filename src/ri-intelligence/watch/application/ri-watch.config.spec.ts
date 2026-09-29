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
				RI_WATCH_ENET_ENABLED: 'false',
			})
		).toEqual({
			enabled: true,
			lookbackDays: 14,
			maxSummariesPerRun: 8,
			dailyFeedEnabled: false,
		});
	});

	// TRA-260: a fonte diaria vem ligada junto com o vigia, mas desliga
	// sozinha — e so ela — se a CVM pedir ou ligar o captcha.
	it('keeps the daily ENET source on unless explicitly turned off', () => {
		expect(loadRiWatchConfig({}).dailyFeedEnabled).toBe(true);
		expect(
			loadRiWatchConfig({ RI_WATCH_ENET_ENABLED: '' }).dailyFeedEnabled
		).toBe(true);
		expect(
			loadRiWatchConfig({ RI_WATCH_ENET_ENABLED: 'TRUE' }).dailyFeedEnabled
		).toBe(true);
	});

	// E um interruptor de desligamento: qualquer outro jeito de escrever
	// "desligado" tem de desligar, nunca cair de volta no ligado.
	it.each(['false', 'False', '0', 'off', 'no', 'talvez'])(
		'turns the daily ENET source off on %p',
		(value) => {
			expect(
				loadRiWatchConfig({ RI_WATCH_ENET_ENABLED: value }).dailyFeedEnabled
			).toBe(false);
		}
	);

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
