import {
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	InviteStatus,
	SnapshotSource,
} from 'src/advisor/domain/enums';
import { AlertsController } from './alerts.controller';
import {
	ADMIN,
	ADMIN_B,
	ADVISOR,
	AttentionApp,
	ORG_A,
	ORG_B,
	buildAttentionApp,
} from './attention-app.fixture-spec';

const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOT_FOUND_BODY = { statusCode: 404, error: 'NOT_FOUND' };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (days: number) => {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + days);
	return isoDate(date);
};

describe('AlertsController', () => {
	let t: AttentionApp;
	const A = () => t.as(ADMIN, ORG_A);
	const ADV = () => t.as(ADVISOR, ORG_A);

	beforeEach(async () => {
		t = await buildAttentionApp([AlertsController]);
	});

	afterEach(async () => {
		await t.app.close();
	});

	describe('guards', () => {
		it('answers 403 ORG_HEADER_REQUIRED on every route without x-org-id', async () => {
			const noOrg = t.as(ADMIN);
			const id = MISSING;
			const calls = [
				() => t.http().get('/advisor/v1/alerts'),
				() => t.http().post('/advisor/v1/alerts').send({}),
				() => t.http().post(`/advisor/v1/alerts/${id}/handle`).send({}),
				() => t.http().post(`/advisor/v1/alerts/${id}/snooze`).send({}),
				() => t.http().post(`/advisor/v1/alerts/${id}/dismiss`).send({}),
				() => t.http().post('/advisor/v1/alerts/bulk').send({}),
			];
			for (const call of calls) {
				const res = await call().set(noOrg).expect(403);
				expect(res.body).toEqual({
					statusCode: 403,
					error: 'FORBIDDEN',
					reason: 'ORG_HEADER_REQUIRED',
				});
			}
		});

		it('answers 401 without a JWT', async () => {
			await t.http().get('/advisor/v1/alerts').expect(401);
		});
	});

	describe('GET /alerts', () => {
		it('lists the queue with messageKey and params untranslated, no-store', async () => {
			const c = await t.client();
			const alert = await t.seedAlert(c.clientProfileId, {
				source: SnapshotSource.B2cShared,
				portfolioId: 'p1',
			});

			const res = await t.http().get('/advisor/v1/alerts').set(A()).expect(200);

			expect(res.headers['cache-control']).toBe('no-store');
			expect(res.body).toEqual({
				items: [
					{
						id: alert.id,
						clientProfileId: c.clientProfileId,
						rule: 'POSITION_DROP',
						source: 'B2C_SHARED',
						portfolioId: 'p1',
						key: 'PETR4',
						priority: 'P1',
						status: 'OPEN',
						messageKey: 'advisor.alert.position_drop',
						params: { symbol: 'PETR4', dropPct: 12.5 },
						evidence: { lastClose: 3010 },
						dataAsOf: '2025-06-16',
						provenance: null,
						lowConfidence: false,
						createdAt: alert.createdAt.toISOString(),
						updatedAt: alert.updatedAt.toISOString(),
					},
				],
				nextCursor: null,
			});
		});

		it('filters by status, priority and rule (comma lists) and pages', async () => {
			const c = await t.client();
			await t.seedAlert(c.clientProfileId, { priority: AlertPriority.P0 });
			await t.seedAlert(c.clientProfileId, {
				rule: AlertRule.Concentration,
				key: 'VALE3',
				priority: AlertPriority.P2,
			});
			const handled = await t.seedAlert(c.clientProfileId, {
				key: 'ITUB4',
				status: AlertStatus.Handled,
				handledVia: AlertHandledVia.Reviewed,
				handledNote: 'falei com ele',
			});

			const p0 = await t
				.http()
				.get('/advisor/v1/alerts?priority=P0,P1')
				.set(A())
				.expect(200);
			expect(p0.body.items.map((a: any) => a.priority)).toEqual(['P0']);

			const conc = await t
				.http()
				.get('/advisor/v1/alerts?rule=CONCENTRATION')
				.set(A())
				.expect(200);
			expect(conc.body.items.map((a: any) => a.key)).toEqual(['VALE3']);

			const closed = await t
				.http()
				.get('/advisor/v1/alerts?status=HANDLED&status=DISMISSED')
				.set(A())
				.expect(200);
			expect(closed.body.items).toHaveLength(1);
			expect(closed.body.items[0]).toMatchObject({
				id: handled.id,
				handledVia: 'REVIEWED',
				handledNote: 'falei com ele',
			});

			const first = await t
				.http()
				.get('/advisor/v1/alerts?limit=1')
				.set(A())
				.expect(200);
			expect(first.body.nextCursor).toEqual(expect.any(String));
			const second = await t
				.http()
				.get(`/advisor/v1/alerts?limit=1&cursor=${first.body.nextCursor}`)
				.set(A())
				.expect(200);
			expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
		});

		it('rejects a bad filter, limit or cursor with 400', async () => {
			for (const q of [
				'priority=P9',
				'rule=FOO',
				'status=OPEN,NOPE',
				'limit=0',
				'limit=101',
				'assignee=bob',
				'extra=1',
			]) {
				const res = await t
					.http()
					.get(`/advisor/v1/alerts?${q}`)
					.set(A())
					.expect(400);
				expect(res.body.reason).toBe('VALIDATION_FAILED');
			}
			const cursor = await t
				.http()
				.get('/advisor/v1/alerts?cursor=forged')
				.set(A())
				.expect(400);
			expect(cursor.body.reason).toBe('INVALID_CURSOR');
		});

		it('answers 400 ASSIGNEE_FILTER_FORBIDDEN to an ADVISOR sending assignee (R17)', async () => {
			const res = await t
				.http()
				.get('/advisor/v1/alerts?assignee=me')
				.set(ADV())
				.expect(400);
			expect(res.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'ASSIGNEE_FILTER_FORBIDDEN',
			});
		});

		it('shows an ADVISOR only the alerts of assigned clients', async () => {
			const mine = await t.client();
			const theirs = await t.client();
			await t.assignments.assign(ORG_A, mine.clientProfileId, ADVISOR, ADMIN);
			const a = await t.seedAlert(mine.clientProfileId);
			await t.seedAlert(theirs.clientProfileId);

			const res = await t
				.http()
				.get('/advisor/v1/alerts')
				.set(ADV())
				.expect(200);
			expect(res.body.items.map((x: any) => x.id)).toEqual([a.id]);

			const admin = await t
				.http()
				.get('/advisor/v1/alerts?assignee=none')
				.set(A())
				.expect(200);
			expect(admin.body.items).toHaveLength(1);
			expect(admin.body.items[0].clientProfileId).toBe(theirs.clientProfileId);
		});
	});

	describe('POST /alerts', () => {
		it('creates a MANUAL alert with 201', async () => {
			const c = await t.client();
			const due = inDays(5);
			const res = await t
				.http()
				.post('/advisor/v1/alerts')
				.set(A())
				.send({
					clientId: c.clientProfileId,
					title: 'Ligar sobre a renovação',
					priority: 'P2',
					dueDate: due,
					note: 'antes do vencimento',
				})
				.expect(201);
			expect(res.body).toMatchObject({
				clientProfileId: c.clientProfileId,
				rule: 'MANUAL',
				source: null,
				priority: 'P2',
				status: 'OPEN',
				messageKey: 'advisor.alert.manual',
				params: {},
				title: 'Ligar sobre a renovação',
				note: 'antes do vencimento',
				dueDate: due,
			});
			expect(await t.alerts.findById(ORG_A, res.body.id)).not.toBeNull();
		});

		it('answers 400 VALIDATION_FAILED for an invalid body', async () => {
			const c = await t.client();
			const valid = { clientId: c.clientProfileId, title: 'T', priority: 'P1' };
			for (const body of [
				{},
				{ ...valid, clientId: 'not-a-uuid' },
				{ ...valid, priority: 'P5' },
				{ ...valid, dueDate: '20/06/2025' },
				{ ...valid, title: 3 },
				{ ...valid, extra: true },
			]) {
				const res = await t
					.http()
					.post('/advisor/v1/alerts')
					.set(A())
					.send(body)
					.expect(400);
				expect(res.body).toEqual({
					statusCode: 400,
					error: 'BAD_REQUEST',
					reason: 'VALIDATION_FAILED',
				});
			}
		});

		it('names the field when the service refuses the input', async () => {
			const c = await t.client();
			const res = await t
				.http()
				.post('/advisor/v1/alerts')
				.set(A())
				.send({
					clientId: c.clientProfileId,
					title: 'x'.repeat(121),
					priority: 'P1',
				})
				.expect(400);
			expect(res.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
				details: { field: 'title' },
			});
		});

		it('answers 404 for a client of another org or out of scope', async () => {
			const other = await t.client(ORG_B);
			const res = await t
				.http()
				.post('/advisor/v1/alerts')
				.set(A())
				.send({ clientId: other.clientProfileId, title: 'T', priority: 'P1' })
				.expect(404);
			expect(res.body).toEqual(NOT_FOUND_BODY);
			const unassigned = await t.client();
			await t
				.http()
				.post('/advisor/v1/alerts')
				.set(ADV())
				.send({
					clientId: unassigned.clientProfileId,
					title: 'T',
					priority: 'P1',
				})
				.expect(404);
		});
	});

	describe('actions on one alert', () => {
		it('answers the client-not-found 404 for an alert of another org, unknown or out of scope', async () => {
			const otherOrgClient = await t.client(ORG_B);
			const foreign = await t.seedAlert(otherOrgClient.clientProfileId, {
				orgId: ORG_B,
			});
			const unassigned = await t.client();
			const hidden = await t.seedAlert(unassigned.clientProfileId);
			const cases: Array<[string, Record<string, string>]> = [
				[foreign.id, A()],
				[MISSING, A()],
				[hidden.id, ADV()],
			];
			for (const [id, headers] of cases) {
				for (const [action, body] of [
					['handle', { via: 'REVIEWED' }],
					['snooze', { until: inDays(3) }],
					['dismiss', { reason: 'não se aplica' }],
				] as const) {
					const res = await t
						.http()
						.post(`/advisor/v1/alerts/${id}/${action}`)
						.set(headers)
						.send(body)
						.expect(404);
					expect(res.body).toEqual(NOT_FOUND_BODY);
				}
			}
			// O ORG_ADMIN da outra org vê o próprio alerta.
			await t
				.http()
				.post(`/advisor/v1/alerts/${foreign.id}/snooze`)
				.set(t.as(ADMIN_B, ORG_B))
				.send({ until: inDays(3) })
				.expect(204);
		});

		it('answers 400 for an id that is not a UUID', async () => {
			const res = await t
				.http()
				.post('/advisor/v1/alerts/nope/handle')
				.set(A())
				.send({ via: 'REVIEWED' })
				.expect(400);
			expect(res.body.statusCode).toBe(400);
		});

		it('handles by e-mail with 200 and the draft; `to` is the only e-mail', async () => {
			const c = await t.client();
			await t.invites.create({
				orgId: ORG_A,
				clientProfileId: c.clientProfileId,
				relationshipId: c.relationshipId,
				email: 'cliente@exemplo.com',
				tokenHash: 'h1',
				status: InviteStatus.Accepted,
				expiresAt: new Date(),
				resendCount: 0,
				invitedByUserId: ADMIN,
			});
			const alert = await t.seedAlert(c.clientProfileId);

			const res = await t
				.http()
				.post(`/advisor/v1/alerts/${alert.id}/handle`)
				.set(A())
				.send({ via: 'EMAIL', note: 'mandei' })
				.expect(200);

			expect(res.body.alert).toMatchObject({
				id: alert.id,
				status: 'HANDLED',
				handledVia: 'EMAIL',
				handledNote: 'mandei',
			});
			expect(res.body.emailDraft).toEqual({
				to: 'cliente@exemplo.com',
				subject: expect.any(String),
				body: expect.any(String),
			});
			const { to, ...rest } = res.body.emailDraft;
			expect(to).toBe('cliente@exemplo.com');
			expect(
				JSON.stringify({ alert: res.body.alert, rest }).includes('@')
			).toBe(false);
		});

		it('handles as REVIEWED without a draft, then answers 409 ALERT_NOT_ACTIVE', async () => {
			const c = await t.client();
			const alert = await t.seedAlert(c.clientProfileId);
			const res = await t
				.http()
				.post(`/advisor/v1/alerts/${alert.id}/handle`)
				.set(A())
				.send({ via: 'REVIEWED' })
				.expect(200);
			expect(res.body.emailDraft).toBeUndefined();
			expect(res.body.alert.status).toBe('HANDLED');

			const again = await t
				.http()
				.post(`/advisor/v1/alerts/${alert.id}/dismiss`)
				.set(A())
				.send({ reason: 'tarde demais' })
				.expect(409);
			expect(again.body).toEqual({
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'ALERT_NOT_ACTIVE',
			});
		});

		it('snoozes and dismisses with 204', async () => {
			const c = await t.client();
			const a = await t.seedAlert(c.clientProfileId);
			const b = await t.seedAlert(c.clientProfileId, { key: 'VALE3' });
			const until = inDays(10);

			await t
				.http()
				.post(`/advisor/v1/alerts/${a.id}/snooze`)
				.set(A())
				.send({ until })
				.expect(204);
			expect(await t.alerts.findById(ORG_A, a.id)).toMatchObject({
				status: AlertStatus.Snoozed,
				snoozedUntil: until,
			});

			await t
				.http()
				.post(`/advisor/v1/alerts/${b.id}/dismiss`)
				.set(A())
				.send({ reason: 'cliente avisado' })
				.expect(204);
			expect(await t.alerts.findById(ORG_A, b.id)).toMatchObject({
				status: AlertStatus.Dismissed,
				dismissReason: 'cliente avisado',
			});
		});

		it('answers 400 VALIDATION_FAILED for bad action bodies', async () => {
			const c = await t.client();
			const a = await t.seedAlert(c.clientProfileId);
			const plain = [
				['handle', {}],
				['handle', { via: 'PHONE' }],
				['snooze', {}],
				['snooze', { until: '2025/06/20' }],
				['dismiss', {}],
				['dismiss', { reason: 1 }],
			] as const;
			for (const [action, body] of plain) {
				const res = await t
					.http()
					.post(`/advisor/v1/alerts/${a.id}/${action}`)
					.set(A())
					.send(body)
					.expect(400);
				expect(res.body.reason).toBe('VALIDATION_FAILED');
			}
			const far = await t
				.http()
				.post(`/advisor/v1/alerts/${a.id}/snooze`)
				.set(A())
				.send({ until: inDays(91) })
				.expect(400);
			expect(far.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
				details: { field: 'until' },
			});
			const blank = await t
				.http()
				.post(`/advisor/v1/alerts/${a.id}/dismiss`)
				.set(A())
				.send({ reason: '   ' })
				.expect(400);
			expect(blank.body.details).toEqual({ field: 'reason' });
		});
	});

	describe('POST /alerts/bulk', () => {
		it('applies to the ids in reach and counts the rest as skipped', async () => {
			const c = await t.client();
			const other = await t.client(ORG_B);
			const a = await t.seedAlert(c.clientProfileId);
			const b = await t.seedAlert(c.clientProfileId, { key: 'VALE3' });
			const foreign = await t.seedAlert(other.clientProfileId, {
				orgId: ORG_B,
			});

			const res = await t
				.http()
				.post('/advisor/v1/alerts/bulk')
				.set(A())
				.send({ action: 'REVIEW', ids: [a.id, b.id, foreign.id, MISSING] })
				.expect(200);
			expect(res.body).toEqual({ affected: 2, skipped: 2 });
			expect((await t.alerts.findById(ORG_A, a.id))?.status).toBe(
				AlertStatus.Handled
			);
		});

		it('applies to a filter', async () => {
			const c = await t.client();
			await t.seedAlert(c.clientProfileId, { priority: AlertPriority.P3 });
			await t.seedAlert(c.clientProfileId, {
				key: 'VALE3',
				priority: AlertPriority.P0,
			});
			const res = await t
				.http()
				.post('/advisor/v1/alerts/bulk')
				.set(A())
				.send({
					action: 'SNOOZE',
					until: inDays(7),
					filter: { priorities: ['P3'] },
				})
				.expect(200);
			expect(res.body).toEqual({ affected: 1, skipped: 0 });
		});

		it('answers 400 VALIDATION_FAILED for a bad bulk body', async () => {
			const ids = Array.from(
				{ length: 501 },
				(_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
			);
			for (const body of [
				{},
				{ action: 'DELETE', ids: [MISSING] },
				{ action: 'REVIEW', ids: ['nope'] },
				{ action: 'REVIEW', ids },
				{ action: 'REVIEW', filter: { priorities: ['P9'] } },
				{ action: 'REVIEW', filter: { assignee: 'bob' } },
				{ action: 'REVIEW', filter: { statuses: ['HANDLED'] } },
				{ action: 'SNOOZE', ids: [MISSING], until: 'amanhã' },
			]) {
				const res = await t
					.http()
					.post('/advisor/v1/alerts/bulk')
					.set(A())
					.send(body)
					.expect(400);
				expect(res.body.reason).toBe('VALIDATION_FAILED');
			}
			const both = await t
				.http()
				.post('/advisor/v1/alerts/bulk')
				.set(A())
				.send({ action: 'REVIEW', ids: [MISSING], filter: {} })
				.expect(400);
			expect(both.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
				details: { field: 'ids' },
			});
		});

		it('answers 400 VALIDATION_FAILED (never 500) for a null or non-object filter and null ids', async () => {
			for (const body of [
				{ action: 'REVIEW', filter: null },
				{ action: 'REVIEW', ids: null },
				{ action: 'REVIEW', filter: 'OPEN' },
				{ action: 'REVIEW', filter: [] },
			]) {
				const res = await t
					.http()
					.post('/advisor/v1/alerts/bulk')
					.set(A())
					.send(body)
					.expect(400);
				expect(res.body).toEqual({
					statusCode: 400,
					error: 'BAD_REQUEST',
					reason: 'VALIDATION_FAILED',
				});
			}
		});

		it('answers 400 ASSIGNEE_FILTER_FORBIDDEN to an ADVISOR filtering by assignee', async () => {
			const res = await t
				.http()
				.post('/advisor/v1/alerts/bulk')
				.set(ADV())
				.send({ action: 'REVIEW', filter: { assignee: 'me' } })
				.expect(400);
			expect(res.body.reason).toBe('ASSIGNEE_FILTER_FORBIDDEN');
		});
	});
});
