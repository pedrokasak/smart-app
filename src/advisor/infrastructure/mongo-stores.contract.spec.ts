import { randomUUID } from 'crypto';
import { Connection, createConnection } from 'mongoose';
import {
	describeAdvisorConsentStoreContract,
	describeAdvisorPortfolioStoreContract,
	describeAdvisorStoreContract,
} from '../application/store-contract.fixture';
import {
	DuplicateMembershipError,
	DuplicateOrganizationOwnerError,
} from '../application/ports/store-errors';
import {
	AdvisorType,
	ConsentStatus,
	InviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	ADVISOR_CLIENT_INVITE_MODEL,
	ADVISOR_CONSENT_MODEL,
	AdvisorClientInviteDoc,
	AdvisorConsentDoc,
	advisorConsentSchemas,
} from './advisor-consent.models';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	ADVISOR_MEMBERSHIP_MODEL,
	ADVISOR_ORGANIZATION_MODEL,
	ADVISOR_RELATIONSHIP_MODEL,
	AdvisorClientProfileDoc,
	AdvisorMembershipDoc,
	AdvisorOrganizationDoc,
	AdvisorRelationshipDoc,
	advisorSchemas,
} from './advisor.models';
import {
	ADVISOR_ALLOCATION_TARGET_MODEL,
	ADVISOR_IMPORT_BATCH_MODEL,
	ADVISOR_TRANSACTION_MODEL,
	AdvisorAllocationTargetDoc,
	AdvisorImportBatchDoc,
	AdvisorTransactionDoc,
	advisorPortfolioSchemas,
} from './advisor-portfolio.models';
import { MongoAllocationTargetStore } from './mongo-allocation-target.store';
import { MongoTransactionStore } from './mongo-transaction.store';
import { assertDisposableDb, buildTestDbName } from './mongo-test-database';
import { MongoClientProfileStore } from './mongo-client-profile.store';
import { MongoConsentStore } from './mongo-consent.store';
import { MongoInviteStore } from './mongo-invite.store';
import { MongoMembershipStore } from './mongo-membership.store';
import { MongoOrganizationStore } from './mongo-organization.store';
import { MongoRelationshipStore } from './mongo-relationship.store';

/**
 * Roda a suíte de contrato dos ports contra o Mongo real. Só executa com
 * `MONGO_TEST_URI` apontando para um Mongo descartável (nunca o do `.env`).
 * Conecta num banco `advisor_contract_<uuid>` gerado por execução, ignorando o
 * banco que a URI nomeia, e só derruba esse banco (com guarda de prefixo).
 */
const TEST_URI = process.env.MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;

describeMongo('advisor mongo stores', () => {
	let conn: Connection;
	let stores: {
		orgs: MongoOrganizationStore;
		memberships: MongoMembershipStore;
		relationships: MongoRelationshipStore;
		profiles: MongoClientProfileStore;
	};
	let consentStores: {
		invites: MongoInviteStore;
		consents: MongoConsentStore;
	};
	let portfolioStores: {
		transactions: MongoTransactionStore;
		targets: MongoAllocationTargetStore;
	};

	beforeAll(async () => {
		conn = await createConnection(TEST_URI as string, {
			dbName: buildTestDbName(),
		}).asPromise();
		assertDisposableDb(conn.name);
		const orgModel = conn.model<AdvisorOrganizationDoc>(
			ADVISOR_ORGANIZATION_MODEL,
			advisorSchemas.organization
		);
		const membershipModel = conn.model<AdvisorMembershipDoc>(
			ADVISOR_MEMBERSHIP_MODEL,
			advisorSchemas.membership
		);
		const relationshipModel = conn.model<AdvisorRelationshipDoc>(
			ADVISOR_RELATIONSHIP_MODEL,
			advisorSchemas.relationship
		);
		const profileModel = conn.model<AdvisorClientProfileDoc>(
			ADVISOR_CLIENT_PROFILE_MODEL,
			advisorSchemas.clientProfile
		);
		const transactionModel = conn.model<AdvisorTransactionDoc>(
			ADVISOR_TRANSACTION_MODEL,
			advisorPortfolioSchemas.transaction
		);
		const importBatchModel = conn.model<AdvisorImportBatchDoc>(
			ADVISOR_IMPORT_BATCH_MODEL,
			advisorPortfolioSchemas.importBatch
		);
		const targetModel = conn.model<AdvisorAllocationTargetDoc>(
			ADVISOR_ALLOCATION_TARGET_MODEL,
			advisorPortfolioSchemas.allocationTarget
		);
		const inviteModel = conn.model<AdvisorClientInviteDoc>(
			ADVISOR_CLIENT_INVITE_MODEL,
			advisorConsentSchemas.clientInvite
		);
		const consentModel = conn.model<AdvisorConsentDoc>(
			ADVISOR_CONSENT_MODEL,
			advisorConsentSchemas.consent
		);
		// `syncIndexes` garante que os índices únicos existem antes dos testes.
		await Promise.all(
			[
				orgModel,
				membershipModel,
				relationshipModel,
				profileModel,
				transactionModel,
				importBatchModel,
				targetModel,
				inviteModel,
				consentModel,
			].map((m) => m.syncIndexes())
		);
		consentStores = {
			invites: new MongoInviteStore(inviteModel),
			consents: new MongoConsentStore(consentModel),
		};
		portfolioStores = {
			transactions: new MongoTransactionStore(
				transactionModel,
				importBatchModel
			),
			targets: new MongoAllocationTargetStore(targetModel),
		};
		stores = {
			orgs: new MongoOrganizationStore(orgModel),
			memberships: new MongoMembershipStore(membershipModel),
			relationships: new MongoRelationshipStore(relationshipModel),
			profiles: new MongoClientProfileStore(profileModel),
		};
	});

	afterAll(async () => {
		if (conn) {
			assertDisposableDb(conn.name);
			await conn.dropDatabase();
			await conn.close();
		}
	});

	describeAdvisorStoreContract('mongo', () => stores);
	describeAdvisorPortfolioStoreContract('mongo', () => portfolioStores);
	describeAdvisorConsentStoreContract('mongo', () => consentStores);

	describe('indexes', () => {
		it('rejects a duplicate membership for the same user and org', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			await stores.memberships.create({ userId, orgId, role: OrgRole.Advisor });
			await expect(
				stores.memberships.create({ userId, orgId, role: OrgRole.OrgAdmin })
			).rejects.toBeInstanceOf(DuplicateMembershipError);
		});

		it('rejects a second org for the same owner with the typed error, not E11000', async () => {
			const ownerUserId = randomUUID();
			await stores.orgs.create({
				name: 'One',
				advisorType: AdvisorType.Assessor,
				ownerUserId,
			});
			await expect(
				stores.orgs.create({
					name: 'Two',
					advisorType: AdvisorType.Assessor,
					ownerUserId,
				})
			).rejects.toBeInstanceOf(DuplicateOrganizationOwnerError);
		});

		it('returns the existing ACTIVE relationship instead of creating a second', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const first = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			const second = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			expect(second).toEqual(first);
		});

		it('allows a new ACTIVE relationship after the previous one was revoked', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const first = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			await stores.relationships.save({
				...first,
				status: RelationshipStatus.Revoked,
			});
			const second = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			expect(second.id).not.toBe(first.id);
			expect(
				await stores.relationships.findByOrgAndClient(orgId, clientProfileId)
			).toEqual(second);
		});

		it('allows several non-ACTIVE rows for the same org and client', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const a = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Revoked,
			});
			const b = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Pending,
			});
			expect(a.id).not.toBe(b.id);
		});

		it('flips origin to CLIENT_CREATED on claim', async () => {
			const created = await stores.profiles.create({
				orgId: randomUUID(),
				name: 'Idx',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const claimed = await stores.profiles.claimIfUnowned(created.id, 'u1');
			expect(claimed?.origin).toBe(ProfileOrigin.ClientCreated);
		});

		const newInvite = (tokenHash: string) => ({
			orgId: randomUUID(),
			clientProfileId: randomUUID(),
			relationshipId: randomUUID(),
			email: `${randomUUID()}@example.com`,
			tokenHash,
			status: InviteStatus.Pending,
			expiresAt: new Date('2030-01-01T00:00:00Z'),
			resendCount: 0,
			invitedByUserId: randomUUID(),
		});

		it('rejects two invites with the same token hash', async () => {
			const tokenHash = randomUUID();
			await consentStores.invites.create(newInvite(tokenHash));
			await expect(
				consentStores.invites.create(newInvite(tokenHash))
			).rejects.toMatchObject({ code: 11000 });
		});

		it('rejects rotating an invite to a token hash that already exists', async () => {
			const taken = randomUUID();
			await consentStores.invites.create(newInvite(taken));
			const other = await consentStores.invites.create(newInvite(randomUUID()));

			await expect(
				consentStores.invites.rotateToken(
					other.id,
					taken,
					new Date('2031-01-01T00:00:00Z'),
					3
				)
			).rejects.toMatchObject({ code: 11000 });
			expect(
				(await consentStores.invites.findById(other.orgId, other.id))
					?.resendCount
			).toBe(0);
		});

		it('keeps one ACTIVE consent when the same user and org are granted in parallel for one relationship', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const relationshipId = randomUUID();
			const grant = () =>
				consentStores.consents.grant({
					orgId,
					clientProfileId: randomUUID(),
					relationshipId,
					userId,
					portfolioIds: [randomUUID()],
					textVersion: 'v1',
					grantedAt: new Date(),
				});

			const granted = await Promise.all([grant(), grant(), grant()]);

			expect(
				await consentStores.consents.listActiveByUser(userId)
			).toHaveLength(1);
			expect(new Set(granted.map((c) => c.version)).size).toBe(3);
			const rows =
				await consentStores.consents.listByRelationship(relationshipId);
			expect(
				rows.filter((c) => c.status === ConsentStatus.Active)
			).toHaveLength(1);
		});

		it('lets only one of two parallel invites of the same org become ACTIVE', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const grant = () =>
				consentStores.consents.grant({
					orgId,
					clientProfileId: randomUUID(),
					relationshipId: randomUUID(),
					userId,
					portfolioIds: [randomUUID()],
					textVersion: 'v1',
					grantedAt: new Date(),
				});

			const results = await Promise.allSettled([grant(), grant()]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
			expect(
				await consentStores.consents.listActiveByUser(userId)
			).toHaveLength(1);
		});
	});
});
