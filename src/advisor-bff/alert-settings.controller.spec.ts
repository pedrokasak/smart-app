import { AlertSettingsController } from './alert-settings.controller';
import {
	ADMIN,
	ADVISOR,
	AttentionApp,
	ORG_A,
	buildAttentionApp,
} from './attention-app.fixture-spec';

const DEFAULTS = {
	noContactDays: [90, 180],
	positionDropPct: [10, 20],
	portfolioDrawdownPct: [8, 15],
	concentrationPct: [25, 35],
	targetDriftPp: [5, 10],
	largeSellsPct: 20,
};

describe('AlertSettingsController', () => {
	let t: AttentionApp;
	const A = () => t.as(ADMIN, ORG_A);

	beforeEach(async () => {
		t = await buildAttentionApp([AlertSettingsController]);
	});

	afterEach(async () => {
		await t.app.close();
	});

	it('answers 403 ORG_HEADER_REQUIRED on both routes without x-org-id', async () => {
		for (const call of [
			() => t.http().get('/advisor/v1/alert-settings'),
			() => t.http().put('/advisor/v1/alert-settings').send(DEFAULTS),
		]) {
			const res = await call().set(t.as(ADMIN)).expect(403);
			expect(res.body.reason).toBe('ORG_HEADER_REQUIRED');
		}
	});

	it('returns the defaults when nothing was saved, to any member', async () => {
		const res = await t
			.http()
			.get('/advisor/v1/alert-settings')
			.set(t.as(ADVISOR, ORG_A))
			.expect(200);
		expect(res.headers['cache-control']).toBe('no-store');
		expect(res.body).toEqual({ ...DEFAULTS, engineEnabledAt: null });
	});

	it('saves the whole set with 200; an omitted field goes back to the default', async () => {
		const res = await t
			.http()
			.put('/advisor/v1/alert-settings')
			.set(A())
			.send({ noContactDays: [60, 120], largeSellsPct: 30 })
			.expect(200);
		expect(res.body).toEqual({
			...DEFAULTS,
			noContactDays: [60, 120],
			largeSellsPct: 30,
			engineEnabledAt: expect.any(String),
		});

		const again = await t
			.http()
			.put('/advisor/v1/alert-settings')
			.set(A())
			.send({ largeSellsPct: 25 })
			.expect(200);
		expect(again.body.noContactDays).toEqual([90, 180]);

		const read = await t
			.http()
			.get('/advisor/v1/alert-settings')
			.set(A())
			.expect(200);
		expect(read.body).toEqual(again.body);
	});

	it('answers 403 ROLE_REQUIRED to an ADVISOR on PUT', async () => {
		const res = await t
			.http()
			.put('/advisor/v1/alert-settings')
			.set(t.as(ADVISOR, ORG_A))
			.send(DEFAULTS)
			.expect(403);
		expect(res.body).toEqual({
			statusCode: 403,
			error: 'FORBIDDEN',
			reason: 'ROLE_REQUIRED',
		});
		expect(await t.settings.find(ORG_A)).toBeNull();
	});

	it('answers 400 VALIDATION_FAILED with the field for bands out of order', async () => {
		const res = await t
			.http()
			.put('/advisor/v1/alert-settings')
			.set(A())
			.send({ ...DEFAULTS, concentrationPct: [35, 25] })
			.expect(400);
		expect(res.body).toEqual({
			statusCode: 400,
			error: 'BAD_REQUEST',
			reason: 'VALIDATION_FAILED',
			details: { field: 'concentrationPct' },
		});
		const equal = await t
			.http()
			.put('/advisor/v1/alert-settings')
			.set(A())
			.send({ positionDropPct: [20, 20] })
			.expect(400);
		expect(equal.body.details).toEqual({ field: 'positionDropPct' });
		expect(await t.settings.find(ORG_A)).toBeNull();
	});

	it('answers 400 VALIDATION_FAILED for values out of range or a bad shape', async () => {
		for (const body of [
			{ noContactDays: [6, 180] },
			{ noContactDays: [90, 731] },
			{ noContactDays: [90.5, 180] },
			{ positionDropPct: [10, 91] },
			{ concentrationPct: [4, 35] },
			{ largeSellsPct: 0 },
			{ largeSellsPct: 101 },
			{ targetDriftPp: [5] },
			{ targetDriftPp: [5, 10, 15] },
			{ targetDriftPp: ['5', '10'] },
			{ unknown: 1 },
		]) {
			const res = await t
				.http()
				.put('/advisor/v1/alert-settings')
				.set(A())
				.send(body)
				.expect(400);
			expect(res.body.reason).toBe('VALIDATION_FAILED');
		}
		expect(await t.settings.find(ORG_A)).toBeNull();
	});
});
