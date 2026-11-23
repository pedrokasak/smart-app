import { AlertPriority } from 'src/advisor/domain/enums';
import {
	ADMIN,
	ADVISOR,
	AttentionApp,
	ORG_A,
	buildAttentionApp,
} from './attention-app.fixture-spec';
import { DashboardController } from './dashboard.controller';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

describe('DashboardController', () => {
	let t: AttentionApp;
	const A = () => t.as(ADMIN, ORG_A);

	beforeEach(async () => {
		t = await buildAttentionApp([DashboardController]);
	});

	afterEach(async () => {
		await t.app.close();
	});

	const snapshot = async (clientProfileId: string, totalMinor: number) => {
		const today = isoDate(new Date());
		await t.snapshots.upsert({
			orgId: ORG_A,
			clientProfileId,
			asOf: today,
			sources: [],
			totalMinor,
			verifiedMinor: totalMinor - 100,
			manualMinor: 100,
			relationshipStartedAt: new Date('2025-01-01T00:00:00.000Z'),
			lastContactAt: null,
			computedAt: new Date(),
		});
	};

	it('answers 403 ORG_HEADER_REQUIRED without x-org-id', async () => {
		const res = await t
			.http()
			.get('/advisor/v1/dashboard')
			.set(t.as(ADMIN))
			.expect(403);
		expect(res.body).toEqual({
			statusCode: 403,
			error: 'FORBIDDEN',
			reason: 'ORG_HEADER_REQUIRED',
		});
	});

	it('returns an empty dashboard for an org with nothing yet', async () => {
		const res = await t
			.http()
			.get('/advisor/v1/dashboard')
			.set(A())
			.expect(200);
		expect(res.headers['cache-control']).toBe('no-store');
		expect(res.body).toEqual({
			wealth: {
				currency: 'BRL',
				totalMinor: null,
				verifiedMinor: null,
				manualMinor: null,
				asOf: null,
			},
			change30d: null,
			clients: 0,
			openAlerts: { P0: 0, P1: 0, P2: 0, P3: 0 },
			topAlerts: [],
			deadlines: [],
			series: [],
		});
	});

	it('sums the snapshots in reach and lists the top alerts as alert DTOs', async () => {
		const c1 = await t.client();
		const c2 = await t.client();
		await snapshot(c1.clientProfileId, 10_000);
		await snapshot(c2.clientProfileId, 5_000);
		await t.assignments.assign(ORG_A, c1.clientProfileId, ADVISOR, ADMIN);
		const alert = await t.seedAlert(c1.clientProfileId, {
			priority: AlertPriority.P0,
		});
		await t.seedAlert(c2.clientProfileId, { priority: AlertPriority.P2 });

		const res = await t
			.http()
			.get('/advisor/v1/dashboard')
			.set(A())
			.expect(200);
		expect(res.body.wealth).toMatchObject({
			currency: 'BRL',
			totalMinor: 15_000,
			verifiedMinor: 14_800,
			manualMinor: 200,
		});
		expect(res.body.clients).toBe(2);
		expect(res.body.openAlerts).toEqual({ P0: 1, P1: 0, P2: 1, P3: 0 });
		expect(res.body.topAlerts[0]).toMatchObject({
			id: alert.id,
			clientProfileId: c1.clientProfileId,
			messageKey: 'advisor.alert.position_drop',
			params: { symbol: 'PETR4', dropPct: 12.5 },
		});

		const advisor = await t
			.http()
			.get('/advisor/v1/dashboard')
			.set(t.as(ADVISOR, ORG_A))
			.expect(200);
		expect(advisor.body.clients).toBe(1);
		expect(advisor.body.topAlerts.map((a: any) => a.id)).toEqual([alert.id]);
	});

	it('accepts days 7 to 365 and rejects anything else with 400 VALIDATION_FAILED', async () => {
		await t.http().get('/advisor/v1/dashboard?days=7').set(A()).expect(200);
		await t.http().get('/advisor/v1/dashboard?days=365').set(A()).expect(200);
		for (const q of ['days=6', 'days=366', 'days=30.5', 'days=abc', 'x=1']) {
			const res = await t
				.http()
				.get(`/advisor/v1/dashboard?${q}`)
				.set(A())
				.expect(400);
			expect(res.body.reason).toBe('VALIDATION_FAILED');
		}
	});
});
