import {
	AdvisorType,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import {
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';

describe('advisor in-memory stores', () => {
	it('exposes distinct DI tokens', () => {
		const tokens = [
			ADVISOR_ORG_STORE,
			ADVISOR_MEMBERSHIP_STORE,
			ADVISOR_RELATIONSHIP_STORE,
			ADVISOR_CLIENT_PROFILE_STORE,
		];
		expect(new Set(tokens).size).toBe(4);
	});

	it('organization: create generates id and findById round-trips', async () => {
		const store = new InMemoryOrganizationStore();
		const created = await store.create({
			name: 'Acme',
			advisorType: AdvisorType.Assessor,
		});
		expect(created.id).toBeTruthy();
		expect(await store.findById(created.id)).toEqual(created);
		expect(await store.findById('missing')).toBeNull();
	});

	it('membership: findByUser and findByUserAndOrg filter', async () => {
		const store = new InMemoryMembershipStore();
		const a = await store.create({
			userId: 'u1',
			orgId: 'o1',
			role: OrgRole.OrgAdmin,
		});
		const b = await store.create({
			userId: 'u1',
			orgId: 'o2',
			role: OrgRole.Advisor,
		});
		await store.create({ userId: 'u2', orgId: 'o1', role: OrgRole.Advisor });

		expect(await store.findByUser('u1')).toEqual([a, b]);
		expect(await store.findByUserAndOrg('u1', 'o2')).toEqual(b);
		expect(await store.findByUserAndOrg('u1', 'o3')).toBeNull();
		expect(await store.findByUserAndOrg('u3', 'o1')).toBeNull();
	});

	it('relationship: findByOrgAndClient prefers ACTIVE, else most recent; save persists', async () => {
		const store = new InMemoryRelationshipStore();
		const revoked = await store.create({
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Revoked,
		});
		const active = await store.create({
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Active,
		});
		await store.create({
			orgId: 'o2',
			clientProfileId: 'c1',
			status: RelationshipStatus.Active,
		});

		expect(await store.findById(active.id)).toEqual(active);
		expect(await store.findByOrgAndClient('o1', 'c1')).toEqual(active);
		expect(await store.findByOrgAndClient('o9', 'c1')).toBeNull();

		const saved = await store.save({
			...active,
			status: RelationshipStatus.Revoked,
		});
		expect(saved.status).toBe(RelationshipStatus.Revoked);
		expect((await store.findById(active.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
		// sem ACTIVE: devolve a mais recente (revogada), não null
		const afterRevoke = await store.findByOrgAndClient('o1', 'c1');
		expect(afterRevoke?.id).toBe(active.id);
		expect(afterRevoke?.status).toBe(RelationshipStatus.Revoked);
		expect(await store.findById(revoked.id)).toEqual(revoked);
	});

	it('relationship: only a revoked row is still returned with its status', async () => {
		const store = new InMemoryRelationshipStore();
		const revoked = await store.create({
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Revoked,
		});
		const found = await store.findByOrgAndClient('o1', 'c1');
		expect(found?.id).toBe(revoked.id);
		expect(found?.status).toBe(RelationshipStatus.Revoked);
	});

	it('client profile: create, findById and save round-trip', async () => {
		const store = new InMemoryClientProfileStore();
		const created = await store.create({
			orgId: 'o1',
			name: 'João',
			origin: ProfileOrigin.AdvisorCreated,
		});
		expect(await store.findById(created.id)).toEqual(created);
		const saved = await store.save({ ...created, ownerUserId: 'u1' });
		expect((await store.findById(created.id))?.ownerUserId).toBe('u1');
		expect(saved.ownerUserId).toBe('u1');
		expect(await store.findById('missing')).toBeNull();
	});
});
