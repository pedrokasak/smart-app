import {
	DAILY_CLOSES_DEFAULTS,
	loadDailyClosesConfig,
} from './daily-closes.config';

describe('loadDailyClosesConfig (TRA-251)', () => {
	it('vem desligado e com os padrões quando nada foi configurado', () => {
		expect(loadDailyClosesConfig({})).toEqual(DAILY_CLOSES_DEFAULTS);
		expect(DAILY_CLOSES_DEFAULTS.enabled).toBe(false);
	});

	it('só liga com o texto exato "true"', () => {
		expect(
			loadDailyClosesConfig({ DAILY_CLOSES_INGEST_ENABLED: 'true' }).enabled
		).toBe(true);
		expect(
			loadDailyClosesConfig({ DAILY_CLOSES_INGEST_ENABLED: '1' }).enabled
		).toBe(false);
	});

	it('lê os limites do ambiente', () => {
		const config = loadDailyClosesConfig({
			COTAHIST_CATCH_UP_DAYS: '10',
			COTAHIST_BACKFILL_YEARS: '3',
			COTAHIST_MAX_YEARS_PER_RUN: '1',
		});

		expect(config).toMatchObject({
			catchUpDays: 10,
			backfillYears: 3,
			maxYearsPerRun: 1,
		});
	});

	it('valor inválido volta ao padrão em vez de derrubar o boot', () => {
		const config = loadDailyClosesConfig({
			COTAHIST_CATCH_UP_DAYS: 'muitos',
			COTAHIST_MAX_YEARS_PER_RUN: '99',
			COTAHIST_BASE_URL: 'não é url',
		});

		expect(config.catchUpDays).toBe(DAILY_CLOSES_DEFAULTS.catchUpDays);
		expect(config.maxYearsPerRun).toBe(DAILY_CLOSES_DEFAULTS.maxYearsPerRun);
		expect(config.baseUrl).toBe(DAILY_CLOSES_DEFAULTS.baseUrl);
	});

	it('tira a barra final da URL base', () => {
		expect(
			loadDailyClosesConfig({ COTAHIST_BASE_URL: 'https://exemplo.com/serie/' })
				.baseUrl
		).toBe('https://exemplo.com/serie');
	});
});
