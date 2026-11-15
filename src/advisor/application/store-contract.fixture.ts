import { randomUUID } from 'crypto';
import {
	AdvisorType,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { RelationshipStorePort } from './ports/relationship.store.port';

export interface AdvisorStores {
	orgs: OrganizationStorePort;
	memberships: MembershipStorePort;
	relationships: RelationshipStorePort;
	profiles: ClientProfileStorePort;
}

/** Garante timestamps de criação distintos (resolução de 1 ms nos stores reais). */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/**
 * Suíte de contrato dos 4 ports. Roda contra qualquer implementação
 * (em memória, Mongo). Cada teste usa ids aleatórios, então não exige coleção
 * limpa.
 */
export function describeAdvisorStoreContract(
	name: string,
	makeStores: () => AdvisorStores
): void {
	describe(`${name} - advisor store contract`, () => {
		let s: AdvisorStores;
		beforeEach(() => {
			s = makeStores();
		});

		it('organization: create/findById round trip; unknown or malformed id gives null', async () => {
			const created = await s.orgs.create({
				name: 'Acme',
				advisorType: AdvisorType.Assessor,
				plan: 'pro',
			});
			expect(created.id).toBeTruthy();
			expect(await s.orgs.findById(created.id)).toEqual(created);
			expect(await s.orgs.findById(randomUUID())).toBeNull();
			expect(await s.orgs.findById('not-an-object-id')).toBeNull();
			expect(await s.orgs.findById('')).toBeNull();
		});

		it('membership: create/findByUserAndOrg round trip; unknown gives null', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const created = await s.memberships.create({
				userId,
				orgId,
				role: OrgRole.OrgAdmin,
			});
			expect(created.id).toBeTruthy();
			expect(await s.memberships.findByUserAndOrg(userId, orgId)).toEqual(
				created
			);
			expect(
				await s.memberships.findByUserAndOrg(userId, randomUUID())
			).toBeNull();
		});

		it('membership: findByUser returns createdAt-ascending order', async () => {
			const userId = randomUUID();
			const first = await s.memberships.create({
				userId,
				orgId: randomUUID(),
				role: OrgRole.OrgAdmin,
			});
			await tick();
			const second = await s.memberships.create({
				userId,
				orgId: randomUUID(),
				role: OrgRole.Advisor,
			});
			await tick();
			const third = await s.memberships.create({
				userId,
				orgId: randomUUID(),
				role: OrgRole.Advisor,
			});
			await s.memberships.create({
				userId: randomUUID(),
				orgId: randomUUID(),
				role: OrgRole.Advisor,
			});

			expect(await s.memberships.findByUser(userId)).toEqual([
				first,
				second,
				third,
			]);
			expect(await s.memberships.findByUser(randomUUID())).toEqual([]);
		});

		it('relationship: create/findById round trip; unknown or malformed id gives null', async () => {
			const created = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Pending,
				consentId: 'consent-1',
				scope: ['VIEW_PORTFOLIO'],
			});
			expect(created.id).toBeTruthy();
			expect(await s.relationships.findById(created.id)).toEqual(created);
			expect(await s.relationships.findById(randomUUID())).toBeNull();
			expect(await s.relationships.findById('not-an-object-id')).toBeNull();
		});

		it('relationship: findByOrgAndClient prefers ACTIVE over a newer non-ACTIVE row', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			await s.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Revoked,
			});
			await tick();
			const active = await s.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			await tick();
			await s.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Revoked,
			});

			expect(
				await s.relationships.findByOrgAndClient(orgId, clientProfileId)
			).toEqual(active);
			expect(
				await s.relationships.findByOrgAndClient(randomUUID(), clientProfileId)
			).toBeNull();
		});

		it('relationship: without ACTIVE returns the most recent row, even a lone REVOKED', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const lone = await s.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Revoked,
			});
			expect(
				await s.relationships.findByOrgAndClient(orgId, clientProfileId)
			).toEqual(lone);

			await tick();
			const newer = await s.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Pending,
			});
			expect(
				await s.relationships.findByOrgAndClient(orgId, clientProfileId)
			).toEqual(newer);
		});

		it('relationship: save persists changes and clears removed optional fields', async () => {
			const created = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
				consentId: 'c1',
				scope: ['VIEW_PORTFOLIO'],
			});
			const saved = await s.relationships.save({
				id: created.id,
				orgId: created.orgId,
				clientProfileId: created.clientProfileId,
				status: RelationshipStatus.Revoked,
			});
			expect(saved.status).toBe(RelationshipStatus.Revoked);
			const reloaded = await s.relationships.findById(created.id);
			expect(reloaded?.status).toBe(RelationshipStatus.Revoked);
			expect(reloaded?.consentId).toBeUndefined();
			expect(reloaded?.scope).toBeUndefined();
		});

		it('client profile: create/findById round trip persists the name; unknown or malformed id gives null', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'João da Silva',
				origin: ProfileOrigin.AdvisorCreated,
			});
			expect(created.id).toBeTruthy();
			const found = await s.profiles.findById(created.id);
			expect(found).toEqual(created);
			expect(found?.name).toBe('João da Silva');
			expect(await s.profiles.findById(randomUUID())).toBeNull();
			expect(await s.profiles.findById('not-an-object-id')).toBeNull();
		});

		it('client profile: create persists the owner when given', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Maria',
				origin: ProfileOrigin.AdvisorCreated,
				ownerUserId: 'u1',
			});
			expect(created.ownerUserId).toBe('u1');
			expect((await s.profiles.findById(created.id))?.ownerUserId).toBe('u1');
		});

		it('client profile: claimIfUnowned - first wins, second gets null, owner unchanged', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Ana',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const first = await s.profiles.claimIfUnowned(created.id, 'u1');
			expect(first).toEqual({
				...created,
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: 'u1',
			});
			expect(await s.profiles.claimIfUnowned(created.id, 'u2')).toBeNull();
			const reloaded = await s.profiles.findById(created.id);
			expect(reloaded?.ownerUserId).toBe('u1');
			expect(reloaded?.origin).toBe(ProfileOrigin.ClientCreated);
		});

		it('client profile: claimIfUnowned returns null for unknown, malformed and client-created profiles', async () => {
			expect(await s.profiles.claimIfUnowned(randomUUID(), 'u1')).toBeNull();
			expect(
				await s.profiles.claimIfUnowned('not-an-object-id', 'u1')
			).toBeNull();
			const own = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Self',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: 'u7',
			});
			expect(await s.profiles.claimIfUnowned(own.id, 'u8')).toBeNull();
			expect((await s.profiles.findById(own.id))?.ownerUserId).toBe('u7');
		});

		it('client profile: concurrent claims have exactly one winner', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Race',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const results = await Promise.all([
				s.profiles.claimIfUnowned(created.id, 'a'),
				s.profiles.claimIfUnowned(created.id, 'b'),
				s.profiles.claimIfUnowned(created.id, 'c'),
			]);
			expect(results.filter((r) => r !== null)).toHaveLength(1);
		});
	});
}
