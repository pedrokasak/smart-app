import { randomUUID } from 'crypto';
import { Connection, createConnection } from 'mongoose';
import { describeAdvisorStoreContract } from '../application/store-contract.fixture';
import { OrgRole, ProfileOrigin, RelationshipStatus } from '../domain/enums';
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
import { assertDisposableDb, buildTestDbName } from './mongo-test-database';
import { MongoClientProfileStore } from './mongo-client-profile.store';
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
		// `syncIndexes` garante que os índices únicos existem antes dos testes.
		await Promise.all(
			[orgModel, membershipModel, relationshipModel, profileModel].map((m) =>
				m.syncIndexes()
			)
		);
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

	describe('indexes', () => {
		it('rejects a duplicate membership for the same user and org', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			await stores.memberships.create({ userId, orgId, role: OrgRole.Advisor });
			await expect(
				stores.memberships.create({ userId, orgId, role: OrgRole.OrgAdmin })
			).rejects.toMatchObject({ code: 11000 });
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
	});
});
