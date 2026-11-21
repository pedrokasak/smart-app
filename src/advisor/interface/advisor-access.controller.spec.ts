import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import {
	AccessGrant,
	ConsentService,
	ConsentTextChangedError,
	InvitePreview,
	InviteNotFoundError,
import { AdvisorType } from '../domain/enums';
import { AdvisorAccessController } from './advisor-access.controller';

const USER = 'user-1';
const TOKEN = 'A'.repeat(42) + '_';
const RELATIONSHIP = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e';

const grant: AccessGrant = {
	relationshipId: RELATIONSHIP,
	organizationName: 'Org A',
	advisorType: AdvisorType.Consultor,
	portfolioIds: ['p1'],
	grantedAt: new Date('2026-11-20T10:00:00Z'),
	consentVersion: 1,
};

const preview: InvitePreview = {
	organizationName: 'Org A',
	advisorType: AdvisorType.Consultor,
	invitedEmailMasked: 'jo***@ex***.com',
	expiresAt: new Date('2026-11-27T10:00:00Z'),
	portfolios: [{ id: 'p1', name: 'Principal' }],
	consentTextVersion: '2026-11-16',
};

describe('AdvisorAccessController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	const consent = {
		previewInvite: jest.fn(),
		acceptInvite: jest.fn(),
		declineInvite: jest.fn(),
		listMyGrants: jest.fn(),
		changeSharedPortfolios: jest.fn(),
		revoke: jest.fn(),
	};

	const bearer = () =>
		`Bearer ${jwt.sign({ userId: USER, type: 'access', role: 'user' })}`;
	const http = () => request(app.getHttpServer());

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [AdvisorAccessController],
			providers: [
				{ provide: APP_GUARD, useClass: JwtAuthGuard },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
				{ provide: ConsentService, useValue: consent },
			],
		}).compile();

		app = moduleRef.createNestApplication();
		// Same pipe as main.ts.
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			})
		);
		await app.init();
		jwt = moduleRef.get(JwtService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		jest.resetAllMocks();
		consent.previewInvite.mockResolvedValue(preview);
		consent.acceptInvite.mockResolvedValue(grant);
		consent.declineInvite.mockResolvedValue(undefined);
		consent.listMyGrants.mockResolvedValue([grant]);
		consent.changeSharedPortfolios.mockResolvedValue(grant);
		consent.revoke.mockResolvedValue(undefined);
	});

	describe('routes', () => {
		it('GET invites/preview: token from the query, no-store and no-referrer', async () => {
			const res = await http()
				.get('/me/advisor-access/invites/preview')
				.query({ token: TOKEN })
				.set('Authorization', bearer())
				.expect(200);

			expect(consent.previewInvite).toHaveBeenCalledWith(USER, TOKEN);
			expect(res.headers['cache-control']).toBe('no-store');
			expect(res.headers['referrer-policy']).toBe('no-referrer');
			expect(res.body).toEqual({
				organizationName: 'Org A',
				advisorType: 'CONSULTOR',
				invitedEmailMasked: 'jo***@ex***.com',
				expiresAt: '2026-11-27T10:00:00.000Z',
				portfolios: [{ id: 'p1', name: 'Principal' }],
				consentTextVersion: '2026-11-16',
			});
		});

		it('POST invites/accept: body token and portfolios', async () => {
			const res = await http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send({ token: TOKEN, portfolioIds: ['p1', 'p2'] })
				.expect(201);

			expect(consent.acceptInvite).toHaveBeenCalledWith(
				USER,
				TOKEN,
				['p1', 'p2'],
				undefined
			);
			expect(res.body).toEqual({
				relationshipId: RELATIONSHIP,
				organizationName: 'Org A',
				advisorType: 'CONSULTOR',
				portfolioIds: ['p1'],
				grantedAt: '2026-11-20T10:00:00.000Z',
				consentVersion: 1,
			});
		});

		it('POST invites/decline: 204', async () => {
			await http()
				.post('/me/advisor-access/invites/decline')
				.set('Authorization', bearer())
				.send({ token: TOKEN })
				.expect(204);

			expect(consent.declineInvite).toHaveBeenCalledWith(USER, TOKEN);
		});

		it('GET /: lists the user grants', async () => {
			const res = await http()
				.get('/me/advisor-access')
				.set('Authorization', bearer())
				.expect(200);

			expect(consent.listMyGrants).toHaveBeenCalledWith(USER);
			expect(res.body).toHaveLength(1);
			expect(res.body[0].relationshipId).toBe(RELATIONSHIP);
		});

		it('PUT :relationshipId/portfolios: changes the scope', async () => {
			await http()
				.put(`/me/advisor-access/${RELATIONSHIP}/portfolios`)
				.set('Authorization', bearer())
				.send({ portfolioIds: ['p2'] })
				.expect(200);

			expect(consent.changeSharedPortfolios).toHaveBeenCalledWith(
				USER,
				RELATIONSHIP,
				['p2']
			);
		});

		it('DELETE :relationshipId: 204', async () => {
			await http()
				.delete(`/me/advisor-access/${RELATIONSHIP}`)
				.set('Authorization', bearer())
				.expect(204);

			expect(consent.revoke).toHaveBeenCalledWith(USER, RELATIONSHIP);
		});

		it('maps InviteNotFoundError to the same 404 on preview, accept and decline', async () => {
			consent.previewInvite.mockRejectedValue(new InviteNotFoundError());
			consent.acceptInvite.mockRejectedValue(new InviteNotFoundError());
			consent.declineInvite.mockRejectedValue(new InviteNotFoundError());

			const responses = [
				await http()
					.get('/me/advisor-access/invites/preview')
					.query({ token: TOKEN })
					.set('Authorization', bearer())
					.expect(404),
				await http()
					.post('/me/advisor-access/invites/accept')
					.set('Authorization', bearer())
					.send({ token: TOKEN, portfolioIds: ['p1'] })
					.expect(404),
				await http()
					.post('/me/advisor-access/invites/decline')
					.set('Authorization', bearer())
					.send({ token: TOKEN })
					.expect(404),
			];

			for (const res of responses) {
				expect(res.body).toEqual(responses[0].body);
				expect(res.body.message).toBe('Invite not found');
			}
		});

		it.each([
			['400 (malformed token)', 'short', 400],
			['404 (unknown invite)', TOKEN, 404],
		])(
			'GET invites/preview: no-store and no-referrer on a %s',
			async (_label, token, status) => {
				consent.previewInvite.mockRejectedValue(new InviteNotFoundError());

				const res = await http()
					.get('/me/advisor-access/invites/preview')
					.query({ token })
					.set('Authorization', bearer())
					.expect(status);

				expect(res.headers['cache-control']).toBe('no-store');
				expect(res.headers['referrer-policy']).toBe('no-referrer');
			}
		);
	});

	describe('consent text version', () => {
		it('forwards a well-formed consentTextVersion to the service', async () => {
			await http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send({
					token: TOKEN,
					portfolioIds: ['p1'],
					consentTextVersion: '2026-11-16',
				})
				.expect(201);

			expect(consent.acceptInvite).toHaveBeenCalledWith(
				USER,
				TOKEN,
				['p1'],
				'2026-11-16'
			);
		});

		it('treats a null consentTextVersion as not sent', async () => {
			consent.acceptInvite.mockResolvedValue(grant);
			await http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send({ token: TOKEN, portfolioIds: ['p1'], consentTextVersion: null })
				.expect(201);
		});

		it.each(['2026-11', 'latest', '2026-11-16T00:00', 20261116])(
			'rejects malformed consentTextVersion %p with 400',
			async (consentTextVersion) => {
				await http()
					.post('/me/advisor-access/invites/accept')
					.set('Authorization', bearer())
					.send({ token: TOKEN, portfolioIds: ['p1'], consentTextVersion })
					.expect(400);

				expect(consent.acceptInvite).not.toHaveBeenCalled();
			}
		);

		it('answers 409 with reason CONSENT_TEXT_CHANGED', async () => {
			consent.acceptInvite.mockRejectedValue(new ConsentTextChangedError());

			const res = await http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send({
					token: TOKEN,
					portfolioIds: ['p1'],
					consentTextVersion: '2025-01-01',
				})
				.expect(409);

			expect(res.body.reason).toBe('CONSENT_TEXT_CHANGED');
		});
	});

	describe('identity', () => {
		it('rejects a userId in the body and never calls the service', async () => {
			await http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send({ token: TOKEN, portfolioIds: ['p1'], userId: 'attacker' })
				.expect(400);

			expect(consent.acceptInvite).not.toHaveBeenCalled();
		});

		it('ignores a userId smuggled into the body object: the JWT user wins', async () => {
			const controller = app.get(AdvisorAccessController);
			const body = {
				token: TOKEN,
				portfolioIds: ['p1'],
				userId: 'attacker',
			};

			await controller.accept({ user: { userId: USER } }, body);
			await controller.change({ user: { userId: USER } }, RELATIONSHIP, {
				portfolioIds: ['p1'],
				userId: 'attacker',
			} as never);

			expect(consent.acceptInvite).toHaveBeenCalledWith(
				USER,
				TOKEN,
				['p1'],
				undefined
			);
			expect(consent.changeSharedPortfolios).toHaveBeenCalledWith(
				USER,
				RELATIONSHIP,
				['p1']
			);
		});
	});

	describe('validation', () => {
		const accept = (body: object) =>
			http()
				.post('/me/advisor-access/invites/accept')
				.set('Authorization', bearer())
				.send(body);

		it.each([
			['42 characters', 'A'.repeat(42)],
			['a plus sign', 'A'.repeat(42) + '+'],
			['44 characters', 'A'.repeat(44)],
		])('rejects a token with %s', async (_label, token) => {
			await accept({ token, portfolioIds: ['p1'] }).expect(400);
			await http()
				.get('/me/advisor-access/invites/preview')
				.query({ token })
				.set('Authorization', bearer())
				.expect(400);
			await http()
				.post('/me/advisor-access/invites/decline')
				.set('Authorization', bearer())
				.send({ token })
				.expect(400);
		});

		it.each([
			['empty', []],
			['51 items', Array.from({ length: 51 }, (_, i) => `p${i}`)],
			['a repeated item', ['p1', 'p1']],
			['a non-string item', ['p1', 7]],
			['an item over 64 characters', ['p'.repeat(65)]],
			['not an array', 'p1'],
		])('rejects portfolioIds %s', async (_label, portfolioIds) => {
			await accept({ token: TOKEN, portfolioIds }).expect(400);
			await http()
				.put(`/me/advisor-access/${RELATIONSHIP}/portfolios`)
				.set('Authorization', bearer())
				.send({ portfolioIds })
				.expect(400);
		});

		it('accepts 50 distinct portfolios', async () => {
			await accept({
				token: TOKEN,
				portfolioIds: Array.from({ length: 50 }, (_, i) => `p${i}`),
			}).expect(201);
		});

		it('rejects a relationshipId that is not a uuid', async () => {
			await http()
				.put('/me/advisor-access/not-a-uuid/portfolios')
				.set('Authorization', bearer())
				.send({ portfolioIds: ['p1'] })
				.expect(400);
			await http()
				.delete('/me/advisor-access/not-a-uuid')
				.set('Authorization', bearer())
				.expect(400);

			expect(consent.changeSharedPortfolios).not.toHaveBeenCalled();
			expect(consent.revoke).not.toHaveBeenCalled();
		});

		it('never reaches the service on a validation failure', async () => {
			await accept({ token: 'short', portfolioIds: [] }).expect(400);
			expect(consent.acceptInvite).not.toHaveBeenCalled();
		});
	});

	describe('authentication', () => {
		it.each([
			['get', `/me/advisor-access/invites/preview?token=${TOKEN}`],
			['post', '/me/advisor-access/invites/accept'],
			['post', '/me/advisor-access/invites/decline'],
			['get', '/me/advisor-access'],
			['put', `/me/advisor-access/${RELATIONSHIP}/portfolios`],
			['delete', `/me/advisor-access/${RELATIONSHIP}`],
		] as const)('%s %s without a JWT is 401', async (method, path) => {
			await http()[method](path).send({}).expect(401);
			for (const fn of Object.values(consent)) {
				expect(fn).not.toHaveBeenCalled();
			}
		});
	});
});
