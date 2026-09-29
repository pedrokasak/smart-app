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
				RI_WATCH_NOTIFY_ENABLED: 'true',
				RI_WATCH_NOTIFY_MAX_AGE_DAYS: '5',
				RI_WATCH_INDEX_ENABLED: 'true',
			})
		).toEqual({
			enabled: true,
			lookbackDays: 14,
			maxSummariesPerRun: 8,
			dailyFeedEnabled: false,
			notifyEnabled: true,
			notifyMaxAgeDays: 5,
			indexEnabled: true,
		});
	});

	// TRA-264: indexar chama o trackerr-ia; so liga com o acervo no ar.
	it.each([undefined, 'True', '1'])('keeps indexing off on %p', (value) => {
		expect(
			loadRiWatchConfig({ RI_WATCH_INDEX_ENABLED: value }).indexEnabled
		).toBe(false);
	});

	// TRA-261: avisar gente e o passo com mais consequencia — so liga quando
	// alguem escreve exatamente "true", depois de validar o resto.
	it.each([undefined, '', 'True', 'yes', '1'])(
		'keeps notifications off on %p',
		(value) => {
			expect(
				loadRiWatchConfig({ RI_WATCH_NOTIFY_ENABLED: value }).notifyEnabled
			).toBe(false);
		}
	);

	it('bounds the notification max age to a week', () => {
		expect(RI_WATCH_DEFAULTS.notifyMaxAgeDays).toBe(3);
		for (const value of ['0', '30', 'abc']) {
			expect(
				loadRiWatchConfig({ RI_WATCH_NOTIFY_MAX_AGE_DAYS: value })
					.notifyMaxAgeDays
			).toBe(RI_WATCH_DEFAULTS.notifyMaxAgeDays);
		}
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
