import {
	DEFAULT_ALERT_SETTINGS,
	validateAlertSettings,
} from './alert-settings';

describe('validateAlertSettings', () => {
	it('returns the defaults for an empty input', () => {
		expect(validateAlertSettings({})).toEqual({
			ok: true,
			value: DEFAULT_ALERT_SETTINGS,
		});
	});

	it('does not share the default arrays with the result', () => {
		const r = validateAlertSettings({});
		if (!r.ok) throw new Error('expected ok');
		r.value.noContactDays[0] = 1;
		expect(DEFAULT_ALERT_SETTINGS.noContactDays).toEqual([90, 180]);
	});

	it('rejects a more severe value that is not larger', () => {
		expect(validateAlertSettings({ noContactDays: [60, 50] })).toEqual({
			ok: false,
			field: 'noContactDays',
		});
		expect(validateAlertSettings({ positionDropPct: [10, 10] })).toEqual({
			ok: false,
			field: 'positionDropPct',
		});
	});

	it('rejects a value out of range', () => {
		expect(validateAlertSettings({ concentrationPct: [4, 35] })).toEqual({
			ok: false,
			field: 'concentrationPct',
		});
		expect(validateAlertSettings({ noContactDays: [60, 731] })).toEqual({
			ok: false,
			field: 'noContactDays',
		});
		expect(validateAlertSettings({ largeSellsPct: 101 })).toEqual({
			ok: false,
			field: 'largeSellsPct',
		});
	});

	it('rejects malformed pairs and non-finite numbers', () => {
		expect(
			validateAlertSettings({
				targetDriftPp: [5] as unknown as [number, number],
			})
		).toEqual({ ok: false, field: 'targetDriftPp' });
		expect(validateAlertSettings({ largeSellsPct: NaN })).toEqual({
			ok: false,
			field: 'largeSellsPct',
		});
	});

	it('turns an omitted largeSellsPct into 20 and keeps given fields', () => {
		const r = validateAlertSettings({ noContactDays: [60, 120] });
		expect(r).toEqual({
			ok: true,
			value: {
				...DEFAULT_ALERT_SETTINGS,
				noContactDays: [60, 120],
				largeSellsPct: 20,
			},
		});
	});
});
