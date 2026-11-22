import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
} from 'src/advisor/application/advisor.tokens';
import { AllocationTargetService } from 'src/advisor/application/allocation-target.service';
import { AssignmentService } from 'src/advisor/application/assignment.service';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import { ClientDirectoryService } from 'src/advisor/application/client-directory.service';
import { ClientProfileService } from 'src/advisor/application/client-profile.service';
import { CsvImportService } from 'src/advisor/application/csv/csv-import.service';
import {
	InMemoryAllocationTargetStore,
	InMemoryAssignmentStore,
	InMemoryBenchmarkSeries,
	InMemoryClientProfileStore,
	InMemoryConsentStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryPortalAccountDirectory,
	InMemoryPriceHistory,
	InMemoryRelationshipStore,
	InMemorySharedPortfolioSource,
	InMemoryTransactionStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MembershipService } from 'src/advisor/application/membership.service';
import { PortfolioMetricsService } from 'src/advisor/application/metrics/portfolio-metrics.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from 'src/advisor/application/ports/portal-account-directory.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from 'src/advisor/application/ports/shared-portfolio-source.port';
import { RelationshipService } from 'src/advisor/application/relationship.service';
import { SharedPortfolioService } from 'src/advisor/application/shared-portfolio.service';
import { TransactionService } from 'src/advisor/application/transaction.service';
import {
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from 'src/advisor/domain/enums';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { OrgPortalGuard } from './org-portal.guard';
import { CSV_UPLOAD_MAX_BYTES } from './csv-upload';
import { WealthSummaryAssembler } from './wealth-summary.assembler';
import { ClientsController } from './clients.controller';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HEADER = 'data;ativo;classe;lado;quantidade;preco;taxas';
const csvOf = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';

const buy = {
	symbol: 'petr4',
	assetClass: 'STOCK',
	side: 'BUY',
	quantity: 10,
	unitPriceMinor: 3500,
	feesMinor: 0,
	currency: 'BRL',
	tradeDate: '2025-01-10',
};

describe('ClientsController', () => {
	let app: INestApplication;
	let jwt: JwtService;
	let profiles: InMemoryClientProfileStore;
	let relationships: InMemoryRelationshipStore;
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	let accounts: InMemoryPortalAccountDirectory;
	let ledger: InMemoryTransactionStore;
	let targets: InMemoryAllocationTargetStore;
	let consents: InMemoryConsentStore;
	let source: InMemorySharedPortfolioSource;
	let imports: CsvImportService;
	const hasAccess = jest.fn();

	const bearer = (userId: string) =>
		`Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`;
	const http = () => request(app.getHttpServer());
	const as = (userId: string, orgId?: string) => {
		const headers: Record<string, string> = {
			Authorization: bearer(userId),
		};
		if (orgId) headers['x-org-id'] = orgId;
		return headers;
	};
	const A = () => as('u1', ORG_A);

	/** Cliente criado pelo assessor via API; devolve o id. */
	const newClient = async (headers: Record<string, string>, name = 'Maria') => {
		const res = await http()
			.post('/advisor/v1/clients')
			.set(headers)
			.send({ name })
			.expect(201);
		return res.body.id as string;
	};

	/** Perfil criado pelo investidor, com relação ACTIVE e consentimento. */
	const seedInvestorClient = async (opts: { consent: boolean }) => {
		const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
		profiles.seed({
			id,
			orgId: ORG_A,
			name: 'Investidor',
			origin: ProfileOrigin.ClientCreated,
			ownerUserId: 'inv1',
		});
		const relationship = await relationships.create({
			orgId: ORG_A,
			clientProfileId: id,
			status: RelationshipStatus.Active,
		});
		if (opts.consent) {
			await consents.grant({
				orgId: ORG_A,
				clientProfileId: id,
				relationshipId: relationship.id,
				userId: 'inv1',
				portfolioIds: ['p1'],
				textVersion: 'v1',
				grantedAt: new Date(),
			});
		}
		return id;
	};

	beforeEach(async () => {
		profiles = new InMemoryClientProfileStore();
		assignments = new InMemoryAssignmentStore();
		accounts = new InMemoryPortalAccountDirectory();
		relationships = new InMemoryRelationshipStore(assignments);
		memberships = new InMemoryMembershipStore();
		ledger = new InMemoryTransactionStore();
		targets = new InMemoryAllocationTargetStore();
		consents = new InMemoryConsentStore();
		source = new InMemorySharedPortfolioSource();
		await memberships.create({
			userId: 'u1',
			orgId: ORG_A,
			role: OrgRole.OrgAdmin,
		});
		await memberships.create({
			userId: 'u2',
			orgId: ORG_B,
			role: OrgRole.OrgAdmin,
		});

		const moduleRef = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: jwtSecret })],
			controllers: [ClientsController],
			providers: [
				OrgContextGuard,
				OrgPortalGuard,
				MembershipService,
				AuthorizationService,
				ClientProfileService,
				RelationshipService,
				ClientDirectoryService,
				TransactionService,
				CsvImportService,
				AllocationTargetService,
				PortfolioMetricsService,
				SharedPortfolioService,
				AssignmentService,
				WealthSummaryAssembler,
				{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
				{ provide: ADVISOR_ASSIGNMENT_STORE, useValue: assignments },
				{ provide: ADVISOR_PORTAL_ACCOUNT_DIRECTORY, useValue: accounts },
				{ provide: ADVISOR_RELATIONSHIP_STORE, useValue: relationships },
				{ provide: ADVISOR_CLIENT_PROFILE_STORE, useValue: profiles },
				{ provide: ADVISOR_INVITE_STORE, useValue: new InMemoryInviteStore() },
				{ provide: ADVISOR_TRANSACTION_STORE, useValue: ledger },
				{ provide: ADVISOR_ALLOCATION_TARGET_STORE, useValue: targets },
				{ provide: ADVISOR_CONSENT_STORE, useValue: consents },
				{ provide: ADVISOR_SHARED_PORTFOLIO_SOURCE, useValue: source },
				{
					provide: ADVISOR_PRICE_HISTORY,
					useValue: new InMemoryPriceHistory(),
				},
				{
					provide: ADVISOR_BENCHMARK_SERIES,
					useValue: new InMemoryBenchmarkSeries(),
				},
				{ provide: AUDIT_TRAIL, useValue: { record: jest.fn() } },
				{ provide: PortalAccessService, useValue: { hasAccess } },
				{
					provide: OrganizationService,
					useValue: {
						ownerOf: async (orgId: string) =>
							({ [ORG_A]: 'u1', [ORG_B]: 'u2' })[orgId] ?? null,
					},
				},
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
				},
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
		imports = moduleRef.get(CsvImportService);
		hasAccess.mockReset().mockResolvedValue(true);
	});

	afterEach(async () => {
		await app.close();
		jest.restoreAllMocks();
	});

	describe('directory', () => {
		it('answers 401 without a JWT and 403 without x-org-id membership', async () => {
			await http().get('/advisor/v1/clients').expect(401);
			await http().get('/advisor/v1/clients').set(as('u1', ORG_B)).expect(403);
			await http()
				.get('/advisor/v1/clients')
				.set(as('nobody', ORG_A))
				.expect(403);
		});

		it('answers 403 PLAN_CAPABILITY_REQUIRED when the org owner has no portal access', async () => {
			hasAccess.mockImplementation(async (userId: string) => userId !== 'u1');
			const res = await http().get('/advisor/v1/clients').set(A()).expect(403);
			expect(res.body).toEqual({
				statusCode: 403,
				error: 'PLAN_CAPABILITY_REQUIRED',
			});
			expect(hasAccess).toHaveBeenCalledWith('u1');
		});

		it('answers 403 ORG_HEADER_REQUIRED without x-org-id, never using the first membership', async () => {
			const res = await http()
				.get('/advisor/v1/clients')
				.set(as('u1'))
				.expect(403);
			expect(res.body).toEqual({
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'ORG_HEADER_REQUIRED',
			});
			const blank = await http()
				.post('/advisor/v1/clients')
				.set({ ...as('u1'), 'x-org-id': '  ' })
				.send({ name: 'Maria' })
				.expect(403);
			expect(blank.body.reason).toBe('ORG_HEADER_REQUIRED');
		});

		it('creates a client and lists it with no-store, only for the active org', async () => {
			const id = await newClient(A(), 'Maria');
			await newClient(as('u2', ORG_B), 'Outra org');

			const res = await http().get('/advisor/v1/clients').set(A()).expect(200);
			expect(res.body).toEqual({
				items: [
					{
						id,
						name: 'Maria',
						origin: 'ADVISOR_CREATED',
						relationshipStatus: 'ACTIVE',
						hasSharedPortfolios: false,
					},
				],
				nextCursor: null,
			});
			expect(res.headers['cache-control']).toBe('no-store');
		});

		it('lists revoked clients with status=REVOKED and pages with the cursor', async () => {
			await newClient(A(), 'C1');
			await newClient(A(), 'C2');
			const first = await http()
				.get('/advisor/v1/clients?limit=1')
				.set(A())
				.expect(200);
			expect(first.body.items).toHaveLength(1);
			expect(first.body.nextCursor).toEqual(expect.any(String));
			const second = await http()
				.get(`/advisor/v1/clients?limit=1&cursor=${first.body.nextCursor}`)
				.set(A())
				.expect(200);
			expect(second.body.items).toHaveLength(1);
			expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

			const revoked = await http()
				.get('/advisor/v1/clients?status=REVOKED')
				.set(A())
				.expect(200);
			expect(revoked.body.items).toEqual([]);
		});

		it('rejects limit=101, limit=0, status=FOO and a forged cursor with 400', async () => {
			await http().get('/advisor/v1/clients?limit=101').set(A()).expect(400);
			await http().get('/advisor/v1/clients?limit=0').set(A()).expect(400);
			await http().get('/advisor/v1/clients?status=FOO').set(A()).expect(400);
			const res = await http()
				.get('/advisor/v1/clients?cursor=forged')
				.set(A())
				.expect(400);
			expect(res.body.reason).toBe('INVALID_CURSOR');
		});

		it('rejects an invalid client name with 400 INVALID_NAME', async () => {
			const res = await http()
				.post('/advisor/v1/clients')
				.set(A())
				.send({ name: '   ' })
				.expect(400);
			expect(res.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'INVALID_NAME',
			});
		});

		it('answers a DTO validation failure with 400 VALIDATION_FAILED and no Nest messages', async () => {
			const res = await http()
				.post('/advisor/v1/clients')
				.set(A())
				.send({})
				.expect(400);
			expect(res.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'VALIDATION_FAILED',
			});
		});
	});

	describe('org isolation (a client of another org is a 404)', () => {
		let foreign: string;

		beforeEach(async () => {
			foreign = await newClient(as('u2', ORG_B), 'Cliente da B');
		});

		it('answers 404 on every route and never writes', async () => {
			const createMany = jest.spyOn(ledger, 'createMany');
			const claimImport = jest.spyOn(ledger, 'claimImport');
			const deleteById = jest.spyOn(ledger, 'deleteById');
			const discardImport = jest.spyOn(ledger, 'discardImport');
			const upsert = jest.spyOn(targets, 'upsert');
			const base = `/advisor/v1/clients/${foreign}`;
			const bare = { statusCode: 404, error: 'NOT_FOUND' };

			const calls: Array<() => request.Test> = [
				() => http().get(`${base}/transactions`),
				() => http().get(`${base}/positions`),
				() => http().get(`${base}/metrics`),
				() => http().get(`${base}/allocation-target`),
				() => http().get(`${base}/shared-portfolios`),
				() => http().get(`${base}/shared-portfolios/metrics`),
				() => http().post(`${base}/transactions`).send(buy),
				() => http().delete(`${base}/transactions/${MISSING}`),
				() =>
					http()
						.post(`${base}/imports`)
						.attach(
							'file',
							Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;1;1,00;0')),
							{
								filename: 'a.csv',
								contentType: 'text/csv',
							}
						),
				() => http().delete(`${base}/imports/${MISSING}`),
				() =>
					http()
						.put(`${base}/allocation-target`)
						.send({ targets: { STOCK: 100 } }),
			];
			for (const call of calls) {
				const res = await call().set(A());
				expect(res.status).toBe(404);
				expect(res.body).toEqual(bare);
			}
			for (const spy of [
				createMany,
				claimImport,
				deleteById,
				discardImport,
				upsert,
			]) {
				expect(spy).not.toHaveBeenCalled();
			}
		});

		it('answers the same 404 for a client id that does not exist', async () => {
			const res = await http()
				.get(`/advisor/v1/clients/${MISSING}/positions`)
				.set(A())
				.expect(404);
			expect(res.body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
		});

		it('answers 400 for an id that is not a UUID', async () => {
			await http()
				.get('/advisor/v1/clients/not-a-uuid/positions')
				.set(A())
				.expect(400);
		});
	});

	describe('ledger', () => {
		let clientId: string;
		beforeEach(async () => {
			clientId = await newClient(A());
		});
		const url = (path: string) => `/advisor/v1/clients/${clientId}${path}`;

		it('records, lists, pages and removes manual transactions', async () => {
			const created = await http()
				.post(url('/transactions'))
				.set(A())
				.send(buy)
				.expect(201);
			expect(created.body).toEqual({
				id: expect.any(String),
				symbol: 'PETR4',
				assetClass: 'STOCK',
				side: 'BUY',
				quantity: 10,
				unitPriceMinor: 3500,
				feesMinor: 0,
				currency: 'BRL',
				tradeDate: '2025-01-10',
				provenance: 'MANUAL',
				source: 'MANUAL_ENTRY',
				createdAt: expect.any(String),
			});
			await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, tradeDate: '2025-01-11' })
				.expect(201);

			const page1 = await http()
				.get(url('/transactions?limit=1'))
				.set(A())
				.expect(200);
			expect(page1.body.items.map((t: any) => t.id)).toEqual([created.body.id]);
			const page2 = await http()
				.get(url(`/transactions?limit=1&cursor=${page1.body.nextCursor}`))
				.set(A())
				.expect(200);
			expect(page2.body.items).toHaveLength(1);
			expect(page2.body.nextCursor).toBeNull();
			const malformed = await http()
				.get(url(`/transactions?cursor=not-a-cursor`))
				.set(A())
				.expect(400);
			expect(malformed.body.reason).toBe('INVALID_CURSOR');

			const positions = await http()
				.get(url('/positions'))
				.set(A())
				.expect(200);
			expect(positions.body).toEqual({
				positions: [expect.objectContaining({ symbol: 'PETR4', quantity: 20 })],
				inconsistencies: [],
			});

			await http()
				.delete(url(`/transactions/${created.body.id}`))
				.set(A())
				.expect(204);
			await http()
				.delete(url(`/transactions/${created.body.id}`))
				.set(A())
				.expect(404);
		});

		it('keeps paging after the cursor row is deleted', async () => {
			const ids: string[] = [];
			for (const day of ['10', '11', '12']) {
				const r = await http()
					.post(url('/transactions'))
					.set(A())
					.send({ ...buy, tradeDate: `2025-01-${day}` })
					.expect(201);
				ids.push(r.body.id);
			}
			const page1 = await http()
				.get(url('/transactions?limit=2'))
				.set(A())
				.expect(200);
			expect(page1.body.items.map((t: any) => t.id)).toEqual(ids.slice(0, 2));
			await http()
				.delete(url(`/transactions/${ids[1]}`))
				.set(A())
				.expect(204);
			const page2 = await http()
				.get(url(`/transactions?limit=2&cursor=${page1.body.nextCursor}`))
				.set(A())
				.expect(200);
			expect(page2.body.items.map((t: any) => t.id)).toEqual([ids[2]]);
			expect(page2.body.nextCursor).toBeNull();
		});

		it('keeps paging after a revert removes rows across the page boundary', async () => {
			const batch = await http()
				.post(url('/imports'))
				.set(A())
				.attach(
					'file',
					Buffer.from(
						csvOf(
							'15/01/2025;VALE3;ACAO;C;1;10,00;0',
							'15/01/2025;VALE3;ACAO;C;2;10,00;0',
							'15/01/2025;VALE3;ACAO;C;3;10,00;0'
						)
					),
					{ filename: 'a.csv', contentType: 'text/csv' }
				)
				.expect(201);
			const manual = await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, tradeDate: '2025-03-01' })
				.expect(201);
			const page1 = await http()
				.get(url('/transactions?limit=2'))
				.set(A())
				.expect(200);
			expect(page1.body.items).toHaveLength(2);
			await http()
				.delete(url(`/imports/${batch.body.importBatchId}`))
				.set(A())
				.expect(200);
			const page2 = await http()
				.get(url(`/transactions?limit=2&cursor=${page1.body.nextCursor}`))
				.set(A())
				.expect(200);
			expect(page2.body.items.map((t: any) => t.id)).toEqual([manual.body.id]);
		});

		it('answers 422 INVALID_TRANSACTION with the rule errors', async () => {
			const res = await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, symbol: '!!', quantity: -1 })
				.expect(422);
			expect(res.body).toEqual({
				statusCode: 422,
				error: 'UNPROCESSABLE_ENTITY',
				reason: 'INVALID_TRANSACTION',
				details: {
					errors: expect.arrayContaining([
						'INVALID_SYMBOL',
						'INVALID_QUANTITY',
					]),
				},
			});
		});

		it('answers 422 OVERSELL with symbol and tradeDate', async () => {
			const res = await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, side: 'SELL' })
				.expect(422);
			expect(res.body).toEqual({
				statusCode: 422,
				error: 'UNPROCESSABLE_ENTITY',
				reason: 'OVERSELL',
				details: { symbol: 'PETR4', tradeDate: '2025-01-10' },
			});
		});

		it('rejects a malformed body with 400 (unknown field, wrong type)', async () => {
			await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, extra: 1 })
				.expect(400);
			await http()
				.post(url('/transactions'))
				.set(A())
				.send({ ...buy, quantity: 'dez' })
				.expect(400);
		});

		it('refuses to delete a VERIFIED (imported) transaction with 403', async () => {
			await http()
				.post(url('/imports'))
				.set(A())
				.attach(
					'file',
					Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0')),
					{
						filename: 'a.csv',
						contentType: 'text/csv',
					}
				)
				.expect(201);
			const list = await http().get(url('/transactions')).set(A()).expect(200);
			const res = await http()
				.delete(url(`/transactions/${list.body.items[0].id}`))
				.set(A())
				.expect(403);
			expect(res.body).toEqual({
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'VERIFIED_IMMUTABLE',
			});
		});
	});

	describe('investor-created client (read-only for the advisor)', () => {
		it('answers 403 ACTION_FORBIDDEN on every write route', async () => {
			const id = await seedInvestorClient({ consent: true });
			const base = `/advisor/v1/clients/${id}`;
			const forbidden = {
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'ACTION_FORBIDDEN',
			};

			const calls: Array<() => request.Test> = [
				() => http().post(`${base}/transactions`).send(buy),
				() => http().delete(`${base}/transactions/${MISSING}`),
				() =>
					http().post(`${base}/imports`).attach('file', Buffer.from(csvOf()), {
						filename: 'a.csv',
						contentType: 'text/csv',
					}),
				() => http().delete(`${base}/imports/${MISSING}`),
				() =>
					http()
						.put(`${base}/allocation-target`)
						.send({ targets: { STOCK: 100 } }),
			];
			for (const call of calls) {
				const res = await call().set(A());
				expect(res.status).toBe(403);
				expect(res.body).toEqual(forbidden);
			}
		});
	});

	describe('CSV import', () => {
		let clientId: string;
		let importCsv: jest.SpyInstance;
		beforeEach(async () => {
			clientId = await newClient(A());
			importCsv = jest.spyOn(imports, 'importCsv');
		});
		const url = () => `/advisor/v1/clients/${clientId}/imports`;
		const upload = (content: Buffer, contentType: string) =>
			http()
				.post(url())
				.set(A())
				.attach('file', content, { filename: 'a.csv', contentType });

		it('imports a CSV decoded as UTF-8 and reverts the batch', async () => {
			const text = csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0');
			const res = await upload(Buffer.from(text, 'utf8'), 'text/csv').expect(
				201
			);
			expect(res.body).toEqual({
				importBatchId: expect.any(String),
				imported: 1,
			});
			expect(importCsv).toHaveBeenCalledWith(
				{ userId: 'u1', orgId: ORG_A },
				clientId,
				text
			);

			const reverted = await http()
				.delete(`${url()}/${res.body.importBatchId}`)
				.set(A())
				.expect(200);
			expect(reverted.body).toEqual({ removed: 1 });
		});

		it('accepts a mimetype with parameters', async () => {
			await upload(
				Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0')),
				'text/csv; charset=utf-8'
			).expect(201);
		});

		it('accepts text/plain', async () => {
			await upload(
				Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0')),
				'text/plain'
			).expect(201);
		});

		it('answers 413 FILE_TOO_LARGE above 1 MB without calling the service', async () => {
			const res = await upload(
				Buffer.alloc(CSV_UPLOAD_MAX_BYTES + 1, 'a'),
				'text/csv'
			).expect(413);
			expect(res.body).toEqual({
				statusCode: 413,
				error: 'PAYLOAD_TOO_LARGE',
				reason: 'FILE_TOO_LARGE',
			});
			expect(importCsv).not.toHaveBeenCalled();
		});

		it('answers 415 UNSUPPORTED_FILE_TYPE for another mimetype', async () => {
			const res = await upload(
				Buffer.from(csvOf()),
				'application/octet-stream'
			).expect(415);
			expect(res.body).toEqual({
				statusCode: 415,
				error: 'UNSUPPORTED_MEDIA_TYPE',
				reason: 'UNSUPPORTED_FILE_TYPE',
			});
			expect(importCsv).not.toHaveBeenCalled();
		});

		it('answers 400 FILE_REQUIRED without a file part', async () => {
			const res = await http().post(url()).set(A()).send({}).expect(400);
			expect(res.body.reason).toBe('FILE_REQUIRED');
			expect(importCsv).not.toHaveBeenCalled();
		});

		it('refuses a text field next to the file (Multer fields: 0) with 400', async () => {
			await http()
				.post(url())
				.set(A())
				.field('other', 'x')
				.attach(
					'file',
					Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0')),
					{
						filename: 'a.csv',
						contentType: 'text/csv',
					}
				)
				.expect(400);
			expect(importCsv).not.toHaveBeenCalled();
		});

		it('answers 422 CSV_REJECTED with the { line, code } rows', async () => {
			const res = await upload(
				Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;0;35,00;0')),
				'text/csv'
			).expect(422);
			expect(res.body).toEqual({
				statusCode: 422,
				error: 'UNPROCESSABLE_ENTITY',
				reason: 'CSV_REJECTED',
				details: {
					errors: [
						expect.objectContaining({ line: 2, code: 'INVALID_QUANTITY' }),
					],
				},
			});
		});

		it('answers 409 DUPLICATE_IMPORT when the same file is sent twice', async () => {
			const file = Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0'));
			await upload(file, 'text/csv').expect(201);
			const res = await upload(file, 'text/csv').expect(409);
			expect(res.body).toEqual({
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'DUPLICATE_IMPORT',
			});
		});

		it('answers 422 OVERSELL when reverting would leave a sale uncovered', async () => {
			const batch = await upload(
				Buffer.from(csvOf('15/01/2025;PETR4;ACAO;C;5;35,00;0')),
				'text/csv'
			).expect(201);
			await http()
				.post(`/advisor/v1/clients/${clientId}/transactions`)
				.set(A())
				.send({ ...buy, side: 'SELL', quantity: 5, tradeDate: '2025-02-01' })
				.expect(201);
			const res = await http()
				.delete(`${url()}/${batch.body.importBatchId}`)
				.set(A())
				.expect(422);
			expect(res.body.reason).toBe('OVERSELL');
			expect(res.body.details).toEqual({
				symbol: 'PETR4',
				tradeDate: '2025-02-01',
			});
		});
	});

	describe('allocation target and metrics', () => {
		let clientId: string;
		beforeEach(async () => {
			clientId = await newClient(A());
		});
		const url = (path: string) => `/advisor/v1/clients/${clientId}${path}`;

		it('answers 200 with nulls before a target exists, then stores it', async () => {
			const empty = await http()
				.get(url('/allocation-target'))
				.set(A())
				.expect(200);
			expect(empty.body).toEqual({ targets: null, updatedAt: null });

			const set = await http()
				.put(url('/allocation-target'))
				.set(A())
				.send({ targets: { STOCK: 60, FII: 40 } })
				.expect(200);
			expect(set.body).toEqual({
				targets: { STOCK: 60, FII: 40 },
				updatedAt: expect.any(String),
			});
			const got = await http()
				.get(url('/allocation-target'))
				.set(A())
				.expect(200);
			expect(got.body.targets).toEqual({ STOCK: 60, FII: 40 });
		});

		it('answers 422 with the reason of an invalid target', async () => {
			const res = await http()
				.put(url('/allocation-target'))
				.set(A())
				.send({ targets: { STOCK: 50 } })
				.expect(422);
			expect(res.body).toEqual({
				statusCode: 422,
				error: 'UNPROCESSABLE_ENTITY',
				reason: 'SUM_NOT_100',
			});
			await http()
				.put(url('/allocation-target'))
				.set(A())
				.send({ targets: 'x' })
				.expect(400);
		});

		it('returns the metrics of an empty book with the unavailable marker', async () => {
			const res = await http().get(url('/metrics')).set(A()).expect(200);
			expect(res.body).toEqual(
				expect.objectContaining({
					currency: 'BRL',
					totalValueMinor: 0,
					positions: [],
				})
			);
			expect(res.body.performance.unavailable).toBe('NO_TRANSACTIONS');
			expect(res.headers['cache-control']).toBe('no-store');
		});
	});

	describe('shared portfolios', () => {
		it('answers 404 without an active consent (metrics and list)', async () => {
			const own = await newClient(A());
			await http()
				.get(`/advisor/v1/clients/${own}/shared-portfolios/metrics`)
				.set(A())
				.expect(404)
				.expect({ statusCode: 404, error: 'NOT_FOUND' });
			await http()
				.get(`/advisor/v1/clients/${own}/shared-portfolios`)
				.set(A())
				.expect(404);

			const investor = await seedInvestorClient({ consent: false });
			await http()
				.get(`/advisor/v1/clients/${investor}/shared-portfolios/metrics`)
				.set(A())
				.expect(404);
		});

		it('lists and measures only the portfolios under active consent', async () => {
			source.add('inv1', { id: 'p1', name: 'Carteira 1' });
			source.add('inv1', { id: 'p2', name: 'Fora do consentimento' });
			const investor = await seedInvestorClient({ consent: true });

			const list = await http()
				.get(`/advisor/v1/clients/${investor}/shared-portfolios`)
				.set(A())
				.expect(200);
			expect(list.body).toEqual([{ id: 'p1', name: 'Carteira 1' }]);

			const metrics = await http()
				.get(`/advisor/v1/clients/${investor}/shared-portfolios/metrics`)
				.set(A())
				.expect(200);
			expect(metrics.body).toEqual([
				expect.objectContaining({
					portfolioId: 'p1',
					name: 'Carteira 1',
					unreconciledSymbols: [],
					metrics: expect.objectContaining({ currency: 'BRL' }),
				}),
			]);
		});
	});

	describe('client detail', () => {
		it('returns the client with a wealth summary per source', async () => {
			const own = await newClient(A());
			const empty = await http()
				.get(`/advisor/v1/clients/${own}`)
				.set(A())
				.expect(200);
			expect(empty.headers['cache-control']).toBe('no-store');
			expect(empty.body).toEqual({
				id: own,
				name: 'Maria',
				origin: 'ADVISOR_CREATED',
				relationshipStatus: 'ACTIVE',
				hasSharedPortfolios: false,
				wealth: {
					currency: 'BRL',
					asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
					totalMinor: 0,
					totalIsPartial: false,
					parts: [],
				},
			});

			await http()
				.post(`/advisor/v1/clients/${own}/transactions`)
				.set(A())
				.send(buy)
				.expect(201);
			const withLedger = await http()
				.get(`/advisor/v1/clients/${own}`)
				.set(A())
				.expect(200);
			expect(withLedger.body.wealth.parts).toEqual([
				{
					source: 'ADVISOR_LEDGER',
					provenance: expect.any(String),
					valueMinor: expect.any(Number),
				},
			]);
			expect(withLedger.body.wealth.totalMinor).toBe(
				withLedger.body.wealth.parts[0].valueMinor
			);
			expect(withLedger.body.wealth.totalIsPartial).toBe(false);
		});

		it('returns the shared part for an investor client under consent', async () => {
			source.add('inv1', { id: 'p1', name: 'Carteira 1' });
			const investor = await seedInvestorClient({ consent: true });
			const res = await http()
				.get(`/advisor/v1/clients/${investor}`)
				.set(A())
				.expect(200);
			expect(res.body.wealth.parts).toEqual([
				expect.objectContaining({ source: 'B2C_SHARED' }),
			]);
		});

		it('answers 400 for a bad id and 404 for a client of another org', async () => {
			await http().get('/advisor/v1/clients/not-a-uuid').set(A()).expect(400);
			const other = await newClient(as('u2', ORG_B));
			await http()
				.get(`/advisor/v1/clients/${other}`)
				.set(A())
				.expect(404)
				.expect({ statusCode: 404, error: 'NOT_FOUND' });
			await http().get(`/advisor/v1/clients/${MISSING}`).set(A()).expect(404);
		});
	});
	describe('assignees', () => {
		// Ids de usuário no formato do projeto (ObjectId).
		const ADVISOR_ID = '64b000000000000000000002';
		const STRANGER = '64b000000000000000000009';
		const advisor = () => as(ADVISOR_ID, ORG_A);
		const assignees = (clientId: string, userId = ADVISOR_ID) =>
			`/advisor/v1/clients/${clientId}/assignees/${userId}`;

		beforeEach(async () => {
			await memberships.create({
				userId: ADVISOR_ID,
				orgId: ORG_A,
				role: OrgRole.Advisor,
			});
			accounts.set(ADVISOR_ID, 'fulano@escritorio.com', 'Fulano');
		});

		it('assigns and unassigns idempotently with 204, and lists the assignees', async () => {
			const client = await newClient(A());
			for (let i = 0; i < 2; i += 1) {
				await http().put(assignees(client)).set(A()).expect(204);
			}
			const list = await http()
				.get(`/advisor/v1/clients/${client}/assignees`)
				.set(A())
				.expect(200);
			expect(list.body).toEqual([{ userId: ADVISOR_ID, name: 'Fulano' }]);
			await http()
				.get(`/advisor/v1/clients/${client}`)
				.set(advisor())
				.expect(200);

			for (let i = 0; i < 2; i += 1) {
				await http().delete(assignees(client)).set(A()).expect(204);
			}
			await http()
				.get(`/advisor/v1/clients/${client}/assignees`)
				.set(A())
				.expect(200)
				.expect([]);
			// Desatribuído: a próxima requisição dá o mesmo 404 de outra org.
			await http()
				.get(`/advisor/v1/clients/${client}`)
				.set(advisor())
				.expect(404)
				.expect({ statusCode: 404, error: 'NOT_FOUND' });
		});

		it('answers 403 ROLE_REQUIRED to an ADVISOR on the three routes', async () => {
			const client = await newClient(A());
			await http().put(assignees(client)).set(A()).expect(204);
			for (const call of [
				() =>
					http().get(`/advisor/v1/clients/${client}/assignees`).set(advisor()),
				() => http().put(assignees(client)).set(advisor()),
				() => http().delete(assignees(client)).set(advisor()),
			]) {
				const res = await call().expect(403);
				expect(res.body).toEqual({
					statusCode: 403,
					error: 'FORBIDDEN',
					reason: 'ROLE_REQUIRED',
				});
			}
		});

		it('answers 404 for a non-member or a client of another org, 400 for bad ids', async () => {
			const client = await newClient(A());
			const other = await newClient(as('u2', ORG_B));
			for (const call of [
				() => http().put(assignees(client, STRANGER)).set(A()),
				() => http().put(assignees(other)).set(A()),
				() => http().get(`/advisor/v1/clients/${other}/assignees`).set(A()),
				() => http().delete(assignees(MISSING)).set(A()),
			]) {
				const res = await call().expect(404);
				expect(res.body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
			}
			await http().put(assignees('not-a-uuid')).set(A()).expect(400);
			await http().put(assignees(client, 'not-a-user')).set(A()).expect(400);
			expect(await assignments.listByClient(ORG_A, client)).toEqual([]);
		});

		it('filters the list by assignee=me|none|<userId> for an ORG_ADMIN', async () => {
			const mine = await newClient(A(), 'Minha');
			const theirs = await newClient(A(), 'Dele');
			const nobody = await newClient(A(), 'Ninguem');
			// u1 (ORG_ADMIN) não tem id no formato do projeto: direto no store.
			await assignments.assign(ORG_A, mine, 'u1', 'u1');
			await http().put(assignees(theirs)).set(A()).expect(204);
			const idsOf = async (query: string) =>
				(
					await http().get(`/advisor/v1/clients?${query}`).set(A()).expect(200)
				).body.items.map((c: any) => c.id);
			expect(await idsOf('assignee=me')).toEqual([mine]);
			expect(await idsOf('assignee=none')).toEqual([nobody]);
			expect(await idsOf(`assignee=${ADVISOR_ID}`)).toEqual([theirs]);
			expect((await idsOf('')).sort()).toEqual([mine, theirs, nobody].sort());
		});

		it('rejects assignee for an ADVISOR (400) and a malformed value', async () => {
			const forbidden = await http()
				.get('/advisor/v1/clients?assignee=none')
				.set(advisor())
				.expect(400);
			expect(forbidden.body).toEqual({
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'ASSIGNEE_FILTER_FORBIDDEN',
			});
			const malformed = await http()
				.get('/advisor/v1/clients?assignee=fulano')
				.set(A())
				.expect(400);
			expect(malformed.body.reason).toBe('VALIDATION_FAILED');
			await http().get('/advisor/v1/clients').set(advisor()).expect(200);
		});
	});
});
