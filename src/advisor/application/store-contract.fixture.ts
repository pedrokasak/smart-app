import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisorType,
	AssetClass,
	ConsentStatus,
	InviteStatus,
	MemberInviteStatus,
	OrgRole,
	ProfileOrigin,
	Provenance,
	RelationshipStatus,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';
import { ERASED_CLIENT_NAME } from '../domain/entities';
import { MemberInvite } from '../domain/team.entities';
import { NewTransaction } from '../domain/portfolio.entities';
import { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import { AssignmentStorePort } from './ports/assignment.store.port';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ConsentStorePort } from './ports/consent.store.port';
import { InviteStorePort } from './ports/invite.store.port';
import { MemberInviteStorePort } from './ports/member-invite.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { PortalGrantStorePort } from './ports/portal-grant.store.port';
import { RelationshipStorePort } from './ports/relationship.store.port';
import {
	DuplicateMembershipError,
	DuplicateOrganizationOwnerError,
	DuplicatePendingMemberInviteError,
	InvalidCursorError,
} from './ports/store-errors';
import {
	DuplicateImportError,
	TransactionStorePort,
} from './ports/transaction.store.port';

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

		it('membership: an explicit createdAt is kept (restoring a removed member)', async () => {
			const orgId = randomUUID();
			const joinedAt = new Date('2026-01-02T03:04:05.000Z');
			const early = await s.memberships.create({
				userId: randomUUID(),
				orgId,
				role: OrgRole.Advisor,
				createdAt: joinedAt,
			});
			await tick();
			const later = await s.memberships.create({
				userId: randomUUID(),
				orgId,
				role: OrgRole.Advisor,
			});

			expect(early.createdAt).toEqual(joinedAt);
			expect(
				(await s.memberships.findByUserAndOrg(early.userId, orgId))?.createdAt
			).toEqual(joinedAt);
			expect((await s.memberships.listByOrg(orgId)).map((m) => m.id)).toEqual([
				early.id,
				later.id,
			]);
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

		it('client profile: setOwnerIfUnowned gives an unowned client-created profile its owner', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Convidado',
				origin: ProfileOrigin.ClientCreated,
			});
			const owned = await s.profiles.setOwnerIfUnowned(created.id, 'u1');
			expect(owned).toEqual({ ...created, ownerUserId: 'u1' });
			const reloaded = await s.profiles.findById(created.id);
			expect(reloaded?.ownerUserId).toBe('u1');
			expect(reloaded?.origin).toBe(ProfileOrigin.ClientCreated);
		});

		it('client profile: setOwnerIfUnowned gives null when already owned, unknown or advisor-created', async () => {
			const owned = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Self',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: 'u7',
			});
			expect(await s.profiles.setOwnerIfUnowned(owned.id, 'u8')).toBeNull();
			expect((await s.profiles.findById(owned.id))?.ownerUserId).toBe('u7');

			expect(await s.profiles.setOwnerIfUnowned(randomUUID(), 'u1')).toBeNull();

			const advisorCreated = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Manual',
				origin: ProfileOrigin.AdvisorCreated,
			});
			expect(
				await s.profiles.setOwnerIfUnowned(advisorCreated.id, 'u1')
			).toBeNull();
			const reloaded = await s.profiles.findById(advisorCreated.id);
			expect(reloaded?.ownerUserId).toBeUndefined();
			expect(reloaded?.origin).toBe(ProfileOrigin.AdvisorCreated);
		});

		it('client profile: concurrent setOwnerIfUnowned has exactly one winner', async () => {
			const created = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Race',
				origin: ProfileOrigin.ClientCreated,
			});
			const results = await Promise.all([
				s.profiles.setOwnerIfUnowned(created.id, 'a'),
				s.profiles.setOwnerIfUnowned(created.id, 'b'),
				s.profiles.setOwnerIfUnowned(created.id, 'c'),
			]);
			const winners = results.filter((r) => r !== null);
			expect(winners).toHaveLength(1);
			expect((await s.profiles.findById(created.id))?.ownerUserId).toBe(
				winners[0]?.ownerUserId
			);
		});

		it('client profile: anonymizeByOwner clears owner and name of that owner profiles only', async () => {
			const owner = randomUUID();
			const first = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Joao Silva',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: owner,
			});
			const second = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Joao S.',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: owner,
			});
			const other = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Maria',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: randomUUID(),
			});
			const unowned = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Manual',
				origin: ProfileOrigin.AdvisorCreated,
			});

			expect(await s.profiles.anonymizeByOwner(owner)).toBe(2);

			for (const id of [first.id, second.id]) {
				expect(await s.profiles.findById(id)).toEqual({
					id,
					orgId: id === first.id ? first.orgId : second.orgId,
					name: ERASED_CLIENT_NAME,
					origin: ProfileOrigin.ClientCreated,
				});
			}
			expect(await s.profiles.findById(other.id)).toEqual(other);
			expect(await s.profiles.findById(unowned.id)).toEqual(unowned);
			expect(await s.profiles.anonymizeByOwner(owner)).toBe(0);
		});

		it('client profile: listIdsByOwner returns the ids of that owner profiles only', async () => {
			const owner = randomUUID();
			const first = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Joao Silva',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: owner,
			});
			const second = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Joao S.',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: owner,
			});
			await s.profiles.create({
				orgId: randomUUID(),
				name: 'Maria',
				origin: ProfileOrigin.ClientCreated,
				ownerUserId: randomUUID(),
			});

			expect([...(await s.profiles.listIdsByOwner(owner))].sort()).toEqual(
				[first.id, second.id].sort()
			);
			expect(await s.profiles.listIdsByOwner(randomUUID())).toEqual([]);
		});

		it('relationship: listActiveByClientProfiles returns only the ACTIVE ones of those profiles', async () => {
			const profileA = randomUUID();
			const profileB = randomUUID();
			const activeA = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: profileA,
				status: RelationshipStatus.Active,
			});
			const activeB = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: profileB,
				status: RelationshipStatus.Active,
			});
			for (const status of [
				RelationshipStatus.Pending,
				RelationshipStatus.Revoked,
			]) {
				await s.relationships.create({
					orgId: randomUUID(),
					clientProfileId: profileA,
					status,
				});
			}
			await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
			});

			const found = await s.relationships.listActiveByClientProfiles([
				profileA,
				profileB,
			]);

			expect(found.map((r) => r.id).sort()).toEqual(
				[activeA.id, activeB.id].sort()
			);
			expect(await s.relationships.listActiveByClientProfiles([])).toEqual([]);
		});

		it('relationship: activate moves PENDING to ACTIVE recording consentId', async () => {
			const created = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Pending,
			});
			const consentId = randomUUID();

			const activated = await s.relationships.activate(created.id, consentId);

			expect(activated).toEqual({
				...created,
				status: RelationshipStatus.Active,
				consentId,
			});
			expect(await s.relationships.findById(created.id)).toEqual(activated);
		});

		it('relationship: activate returns null for ACTIVE, REVOKED and unknown relationships', async () => {
			const active = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
				consentId: 'keep',
			});
			const revoked = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Revoked,
			});

			expect(await s.relationships.activate(active.id, 'x')).toBeNull();
			expect(await s.relationships.activate(revoked.id, 'x')).toBeNull();
			expect(await s.relationships.activate(randomUUID(), 'x')).toBeNull();
			expect((await s.relationships.findById(active.id))?.consentId).toBe(
				'keep'
			);
			expect((await s.relationships.findById(revoked.id))?.status).toBe(
				RelationshipStatus.Revoked
			);
		});

		it('relationship: setConsentIfActive updates consentId of an ACTIVE relationship', async () => {
			const created = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
				consentId: 'c1',
			});
			const updated = await s.relationships.setConsentIfActive(
				created.id,
				'c2'
			);
			expect(updated).toEqual({ ...created, consentId: 'c2' });
			expect(await s.relationships.findById(created.id)).toEqual(updated);
		});

		it('relationship: setConsentIfActive gives null and changes nothing for REVOKED, PENDING and unknown', async () => {
			for (const status of [
				RelationshipStatus.Revoked,
				RelationshipStatus.Pending,
			]) {
				const created = await s.relationships.create({
					orgId: randomUUID(),
					clientProfileId: randomUUID(),
					status,
					consentId: 'c1',
				});
				expect(
					await s.relationships.setConsentIfActive(created.id, 'c2')
				).toBeNull();
				expect(await s.relationships.findById(created.id)).toEqual(created);
			}
			expect(
				await s.relationships.setConsentIfActive(randomUUID(), 'c2')
			).toBeNull();
		});

		it('relationship: concurrent activate has exactly one winner', async () => {
			const created = await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Pending,
			});
			const results = await Promise.all([
				s.relationships.activate(created.id, 'a'),
				s.relationships.activate(created.id, 'b'),
				s.relationships.activate(created.id, 'c'),
			]);

			const winners = results.filter((r) => r !== null);
			expect(winners).toHaveLength(1);
			expect((await s.relationships.findById(created.id))?.consentId).toBe(
				winners[0].consentId
			);
		});

		it('organization: a second org with the same ownerUserId is rejected', async () => {
			const ownerUserId = randomUUID();
			const first = await s.orgs.create({
				name: 'A',
				advisorType: AdvisorType.Assessor,
				ownerUserId,
			});
			expect(first.ownerUserId).toBe(ownerUserId);
			expect(await s.orgs.findById(first.id)).toEqual(first);

			await expect(
				s.orgs.create({
					name: 'B',
					advisorType: AdvisorType.Assessor,
					ownerUserId,
				})
			).rejects.toBeInstanceOf(DuplicateOrganizationOwnerError);
		});

		it('organization: parallel creates for one owner keep exactly one', async () => {
			const ownerUserId = randomUUID();
			const create = () =>
				s.orgs.create({
					name: 'Race',
					advisorType: AdvisorType.Assessor,
					ownerUserId,
				});

			const results = await Promise.allSettled([create(), create()]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === 'rejected'
			);
			expect(rejected).toHaveLength(1);
			expect(rejected[0].reason).toBeInstanceOf(
				DuplicateOrganizationOwnerError
			);
		});

		it('organization: orgs without ownerUserId never conflict', async () => {
			const a = await s.orgs.create({
				name: 'A',
				advisorType: AdvisorType.Assessor,
			});
			const b = await s.orgs.create({
				name: 'B',
				advisorType: AdvisorType.Assessor,
			});
			expect(a.id).not.toBe(b.id);
			expect(a.ownerUserId).toBeUndefined();
		});

		it('organization: delete removes the org and is idempotent', async () => {
			const ownerUserId = randomUUID();
			const created = await s.orgs.create({
				name: 'Gone',
				advisorType: AdvisorType.Assessor,
				ownerUserId,
			});
			const other = await s.orgs.create({
				name: 'Stays',
				advisorType: AdvisorType.Assessor,
			});

			await s.orgs.delete(created.id);
			await s.orgs.delete(created.id);

			expect(await s.orgs.findById(created.id)).toBeNull();
			expect(await s.orgs.findById(other.id)).toEqual(other);
			// o dono volta a poder criar outra organização
			await expect(
				s.orgs.create({
					name: 'Again',
					advisorType: AdvisorType.Assessor,
					ownerUserId,
				})
			).resolves.toBeDefined();
		});

		it('membership: a repeated (userId, orgId) pair is rejected', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			await s.memberships.create({ userId, orgId, role: OrgRole.OrgAdmin });

			await expect(
				s.memberships.create({ userId, orgId, role: OrgRole.Advisor })
			).rejects.toBeInstanceOf(DuplicateMembershipError);
			expect(
				await s.memberships.create({
					userId,
					orgId: randomUUID(),
					role: OrgRole.Advisor,
				})
			).toBeDefined();
		});

		it('relationship: listByOrg filters by status and ignores other orgs', async () => {
			const orgId = randomUUID();
			const pending = await s.relationships.create({
				orgId,
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Pending,
			});
			await tick();
			const active = await s.relationships.create({
				orgId,
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
			});
			await tick();
			await s.relationships.create({
				orgId,
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Revoked,
			});
			await s.relationships.create({
				orgId: randomUUID(),
				clientProfileId: randomUUID(),
				status: RelationshipStatus.Active,
			});

			const page = await s.relationships.listByOrg(orgId, {
				statuses: [RelationshipStatus.Active, RelationshipStatus.Pending],
				limit: 10,
			});

			expect(page.items).toEqual([active, pending]);
			expect(page.nextCursor).toBeNull();
			expect(
				(
					await s.relationships.listByOrg(orgId, {
						statuses: [],
						limit: 10,
					})
				).items
			).toEqual([]);
		});

		it('relationship: listByOrg pages newest first without repeating or skipping', async () => {
			const orgId = randomUUID();
			const created = [];
			for (let i = 0; i < 5; i += 1) {
				created.push(
					await s.relationships.create({
						orgId,
						clientProfileId: randomUUID(),
						status: RelationshipStatus.Active,
					})
				);
				await tick();
			}
			const newestFirst = [...created].reverse();
			const query = { statuses: [RelationshipStatus.Active], limit: 2 };

			const page1 = await s.relationships.listByOrg(orgId, query);
			expect(page1.items).toEqual(newestFirst.slice(0, 2));
			expect(page1.nextCursor).toEqual(expect.any(String));

			const page2 = await s.relationships.listByOrg(orgId, {
				...query,
				cursor: page1.nextCursor as string,
			});
			expect(page2.items).toEqual(newestFirst.slice(2, 4));
			expect(page2.nextCursor).toEqual(expect.any(String));

			const page3 = await s.relationships.listByOrg(orgId, {
				...query,
				cursor: page2.nextCursor as string,
			});
			expect(page3.items).toEqual(newestFirst.slice(4));
			expect(page3.nextCursor).toBeNull();
		});

		it('client profile: findByIds returns only profiles of that org', async () => {
			const orgId = randomUUID();
			const mine = await s.profiles.create({
				orgId,
				name: 'Mine',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const mine2 = await s.profiles.create({
				orgId,
				name: 'Mine 2',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const foreign = await s.profiles.create({
				orgId: randomUUID(),
				name: 'Foreign',
				origin: ProfileOrigin.AdvisorCreated,
			});

			const found = await s.profiles.findByIds(orgId, [
				mine.id,
				foreign.id,
				randomUUID(),
				mine2.id,
			]);

			expect(found.map((p) => p.id).sort()).toEqual([mine.id, mine2.id].sort());
			expect(await s.profiles.findByIds(orgId, [])).toEqual([]);
		});
	});
}

export interface AdvisorConsentStores {
	invites: InviteStorePort;
	consents: ConsentStorePort;
}

/**
 * Suíte de contrato dos ports de convite e consentimento. Ids aleatórios por
 * teste; não assume coleção vazia.
 */
export function describeAdvisorConsentStoreContract(
	name: string,
	makeStores: () => AdvisorConsentStores
): void {
	describe(`${name} - advisor consent store contract`, () => {
		let s: AdvisorConsentStores;
		beforeEach(() => {
			s = makeStores();
		});

		const newInvite = (
			overrides: Partial<Omit<ClientInvite, 'id' | 'createdAt'>> = {}
		): Omit<ClientInvite, 'id' | 'createdAt'> => ({
			orgId: randomUUID(),
			clientProfileId: randomUUID(),
			relationshipId: randomUUID(),
			email: `${randomUUID()}@example.com`,
			tokenHash: randomUUID(),
			status: InviteStatus.Pending,
			expiresAt: new Date('2030-01-01T00:00:00Z'),
			resendCount: 0,
			invitedByUserId: randomUUID(),
			...overrides,
		});

		const newConsent = (
			overrides: Partial<
				Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'>
			> = {}
		): Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'> => ({
			orgId: randomUUID(),
			clientProfileId: randomUUID(),
			relationshipId: randomUUID(),
			userId: randomUUID(),
			portfolioIds: [randomUUID()],
			textVersion: 'v1',
			grantedAt: new Date('2030-01-01T00:00:00Z'),
			...overrides,
		});

		it('invite: create round trips by token hash; unknown hash gives null', async () => {
			const created = await s.invites.create(newInvite());

			expect(created.id).toBeTruthy();
			expect(created.createdAt).toBeInstanceOf(Date);
			expect(await s.invites.findByTokenHash(created.tokenHash)).toEqual(
				created
			);
			expect(await s.invites.findByTokenHash(randomUUID())).toBeNull();
		});

		it('invite: findById is scoped to the organization', async () => {
			const created = await s.invites.create(newInvite());

			expect(await s.invites.findById(created.orgId, created.id)).toEqual(
				created
			);
			expect(await s.invites.findById(randomUUID(), created.id)).toBeNull();
			expect(await s.invites.findById(created.orgId, randomUUID())).toBeNull();
		});

		it('invite: transition PENDING to ACCEPTED sets respondedAt, then returns null', async () => {
			const created = await s.invites.create(newInvite());
			const at = new Date('2030-02-01T00:00:00Z');

			const accepted = await s.invites.transition(
				created.id,
				InviteStatus.Accepted,
				at
			);

			expect(accepted?.status).toBe(InviteStatus.Accepted);
			expect(accepted?.respondedAt).toEqual(at);
			expect(
				await s.invites.transition(created.id, InviteStatus.Declined, at)
			).toBeNull();
			expect(
				(await s.invites.findById(created.orgId, created.id))?.status
			).toBe(InviteStatus.Accepted);
		});

		it('invite: transition of an unknown invite gives null', async () => {
			expect(
				await s.invites.transition(
					randomUUID(),
					InviteStatus.Accepted,
					new Date()
				)
			).toBeNull();
		});

		it('invite: concurrent transitions have exactly one winner', async () => {
			const created = await s.invites.create(newInvite());
			const at = new Date();

			const results = await Promise.all([
				s.invites.transition(created.id, InviteStatus.Accepted, at),
				s.invites.transition(created.id, InviteStatus.Declined, at),
				s.invites.transition(created.id, InviteStatus.Cancelled, at),
			]);

			expect(results.filter((r) => r !== null)).toHaveLength(1);
		});

		it('invite: rotateToken swaps hash and expiry, counts the resend and retires the old hash', async () => {
			const created = await s.invites.create(newInvite());
			const newHash = randomUUID();
			const expiresAt = new Date('2031-01-01T00:00:00Z');

			const rotated = await s.invites.rotateToken(
				created.id,
				newHash,
				expiresAt,
				3
			);

			expect(rotated?.tokenHash).toBe(newHash);
			expect(rotated?.expiresAt).toEqual(expiresAt);
			expect(rotated?.resendCount).toBe(1);
			expect(await s.invites.findByTokenHash(created.tokenHash)).toBeNull();
			expect((await s.invites.findByTokenHash(newHash))?.id).toBe(created.id);
		});

		it('invite: rotateToken stops at max resends', async () => {
			const created = await s.invites.create(newInvite());
			const expiresAt = new Date('2031-01-01T00:00:00Z');

			for (let i = 1; i <= 3; i += 1) {
				const rotated = await s.invites.rotateToken(
					created.id,
					randomUUID(),
					expiresAt,
					3
				);
				expect(rotated?.resendCount).toBe(i);
			}
			const refused = await s.invites.rotateToken(
				created.id,
				randomUUID(),
				expiresAt,
				3
			);

			expect(refused).toBeNull();
			expect(
				(await s.invites.findById(created.orgId, created.id))?.resendCount
			).toBe(3);
		});

		it('invite: rotateToken on a non-PENDING invite gives null', async () => {
			const created = await s.invites.create(newInvite());
			await s.invites.transition(
				created.id,
				InviteStatus.Cancelled,
				new Date()
			);

			expect(
				await s.invites.rotateToken(created.id, randomUUID(), new Date(), 3)
			).toBeNull();
			expect(await s.invites.findByTokenHash(created.tokenHash)).not.toBeNull();
		});

		it('invite: findPendingByOrgAndEmail ignores other orgs, other emails and non-PENDING', async () => {
			const orgId = randomUUID();
			const email = `${randomUUID()}@example.com`;
			const pending = await s.invites.create(newInvite({ orgId, email }));
			await s.invites.create(newInvite({ email }));
			await s.invites.create(newInvite({ orgId }));
			const accepted = await s.invites.create(newInvite({ orgId, email }));
			await s.invites.transition(
				accepted.id,
				InviteStatus.Accepted,
				new Date()
			);

			const found = await s.invites.findPendingByOrgAndEmail(orgId, email);

			expect(found.map((i) => i.id)).toEqual([pending.id]);
		});

		it('invite: listPendingByOrg returns only unexpired PENDING invites of the org, newest first', async () => {
			const orgId = randomUUID();
			const now = new Date('2029-06-01T00:00:00Z');
			const older = await s.invites.create(newInvite({ orgId }));
			await tick();
			const newer = await s.invites.create(newInvite({ orgId }));
			await s.invites.create(
				newInvite({ orgId, expiresAt: new Date('2029-05-01T00:00:00Z') })
			);
			await s.invites.create(
				newInvite({ orgId, expiresAt: new Date('2029-06-01T00:00:00Z') })
			);
			const accepted = await s.invites.create(newInvite({ orgId }));
			await s.invites.transition(accepted.id, InviteStatus.Accepted, now);
			await s.invites.create(newInvite());

			const pending = await s.invites.listPendingByOrg(orgId, now);

			expect(pending.map((i) => i.id)).toEqual([newer.id, older.id]);
			expect(await s.invites.listPendingByOrg(randomUUID(), now)).toEqual([]);
		});

		it('invite: deleteByEmail removes only that e-mail and returns the count', async () => {
			const email = `${randomUUID()}@example.com`;
			await s.invites.create(newInvite({ email }));
			await s.invites.create(newInvite({ email }));
			const other = await s.invites.create(newInvite());

			expect(await s.invites.deleteByEmail(email)).toBe(2);
			expect(await s.invites.deleteByEmail(email)).toBe(0);
			expect(await s.invites.findByTokenHash(other.tokenHash)).not.toBeNull();
		});

		it('invite: deleteByRelationshipIds removes only those relationships and returns the count', async () => {
			const relationshipA = randomUUID();
			const relationshipB = randomUUID();
			await s.invites.create(newInvite({ relationshipId: relationshipA }));
			await s.invites.create(newInvite({ relationshipId: relationshipB }));
			const other = await s.invites.create(newInvite());

			expect(
				await s.invites.deleteByRelationshipIds([relationshipA, relationshipB])
			).toBe(2);
			expect(await s.invites.deleteByRelationshipIds([relationshipA])).toBe(0);
			expect(await s.invites.deleteByRelationshipIds([])).toBe(0);
			expect(await s.invites.findByTokenHash(other.tokenHash)).not.toBeNull();
		});

		it('consent: the second grant supersedes the first, which keeps its history', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();
			const first = await s.consents.grant(
				newConsent({ relationshipId, userId })
			);
			await tick();
			const secondGrantedAt = new Date('2030-03-01T00:00:00Z');
			const second = await s.consents.grant(
				newConsent({ relationshipId, userId, grantedAt: secondGrantedAt })
			);

			expect(first.version).toBe(1);
			expect(first.status).toBe(ConsentStatus.Active);
			expect(second.version).toBe(2);
			expect(second.status).toBe(ConsentStatus.Active);
			expect(
				(await s.consents.findActiveByRelationship(relationshipId))?.id
			).toBe(second.id);
			expect(
				(await s.consents.listActiveByUser(userId)).map((c) => c.id)
			).toEqual([second.id]);

			const rows = await s.consents.listByRelationship(relationshipId);
			expect(rows.map((c) => c.version)).toEqual([1, 2]);
			expect(rows[0].id).toBe(first.id);
			expect(rows[0].status).toBe(ConsentStatus.Superseded);
			expect(rows[0].endedAt?.getTime()).toBe(secondGrantedAt.getTime());
			expect(rows[1].id).toBe(second.id);
			expect(rows[1].status).toBe(ConsentStatus.Active);
			expect(rows[1].endedAt).toBeUndefined();
		});

		it('consent: revoking ends only the active row and keeps the superseded one', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();
			await s.consents.grant(newConsent({ relationshipId, userId }));
			const second = await s.consents.grant(
				newConsent({ relationshipId, userId })
			);
			const at = new Date('2030-05-01T00:00:00Z');

			const revoked = await s.consents.revokeActive(relationshipId, userId, at);

			expect(revoked?.id).toBe(second.id);
			expect(revoked?.version).toBe(2);
			const rows = await s.consents.listByRelationship(relationshipId);
			expect(rows.map((c) => c.status)).toEqual([
				ConsentStatus.Superseded,
				ConsentStatus.Revoked,
			]);
			expect(rows[0].endedAt).toBeInstanceOf(Date);
			expect(rows[1].endedAt?.getTime()).toBe(at.getTime());
		});

		it('consent: listByRelationship of an unknown relationship is empty', async () => {
			expect(await s.consents.listByRelationship(randomUUID())).toEqual([]);
		});

		it('consent: concurrent grants leave exactly one ACTIVE consent with distinct versions', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();

			const granted = await Promise.all([
				s.consents.grant(newConsent({ relationshipId, userId })),
				s.consents.grant(newConsent({ relationshipId, userId })),
				s.consents.grant(newConsent({ relationshipId, userId })),
			]);

			expect(await s.consents.listActiveByUser(userId)).toHaveLength(1);
			expect(new Set(granted.map((c) => c.version)).size).toBe(3);
		});

		it('consent: a second ACTIVE link of the same user to the same org (other relationship) is refused', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const first = await s.consents.grant(newConsent({ userId, orgId }));

			await expect(
				s.consents.grant(newConsent({ userId, orgId }))
			).rejects.toBeInstanceOf(ConflictException);

			expect(
				(await s.consents.listActiveByUser(userId)).map((c) => c.id)
			).toEqual([first.id]);
		});

		it('consent: the same user may link to the same org again after revoking', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const first = await s.consents.grant(newConsent({ userId, orgId }));
			await s.consents.revokeActive(first.relationshipId, userId, new Date());

			const again = await s.consents.grant(newConsent({ userId, orgId }));

			expect(again.status).toBe(ConsentStatus.Active);
		});

		it('consent: a changed scope on the same relationship is not a second link', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const relationshipId = randomUUID();
			await s.consents.grant(newConsent({ userId, orgId, relationshipId }));

			const second = await s.consents.grant(
				newConsent({ userId, orgId, relationshipId })
			);

			expect(second.version).toBe(2);
		});

		it('consent: findActiveByRelationship gives null when nothing was granted', async () => {
			expect(
				await s.consents.findActiveByRelationship(randomUUID())
			).toBeNull();
		});

		it('consent: revokeActive with the wrong user gives null and keeps it ACTIVE', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();
			const granted = await s.consents.grant(
				newConsent({ relationshipId, userId })
			);

			expect(
				await s.consents.revokeActive(relationshipId, randomUUID(), new Date())
			).toBeNull();
			expect(
				(await s.consents.findActiveByRelationship(relationshipId))?.id
			).toBe(granted.id);
		});

		it('consent: revokeActive ends the consent as REVOKED once', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();
			await s.consents.grant(newConsent({ relationshipId, userId }));
			const at = new Date('2030-04-01T00:00:00Z');

			const revoked = await s.consents.revokeActive(relationshipId, userId, at);

			expect(revoked?.status).toBe(ConsentStatus.Revoked);
			expect(revoked?.endedAt).toEqual(at);
			expect(
				await s.consents.findActiveByRelationship(relationshipId)
			).toBeNull();
			expect(
				await s.consents.revokeActive(relationshipId, userId, at)
			).toBeNull();
		});

		it('consent: listActiveByUser only returns the user consents', async () => {
			const userId = randomUUID();
			const mine = await s.consents.grant(newConsent({ userId }));
			await s.consents.grant(newConsent());

			const active = await s.consents.listActiveByUser(userId);

			expect(active.map((c) => c.id)).toEqual([mine.id]);
		});

		it('consent: listByUser returns every version of the user consents only', async () => {
			const userId = randomUUID();
			const relationshipId = randomUUID();
			const first = await s.consents.grant(
				newConsent({ userId, relationshipId })
			);
			const second = await s.consents.grant(
				newConsent({
					userId,
					relationshipId,
					grantedAt: new Date('2030-02-01T00:00:00Z'),
				})
			);
			const ended = await s.consents.grant(newConsent({ userId }));
			await s.consents.revokeActive(
				ended.relationshipId,
				userId,
				new Date('2030-03-01T00:00:00Z')
			);
			await s.consents.grant(newConsent());

			const mine = await s.consents.listByUser(userId);

			expect(mine.map((c) => c.id).sort()).toEqual(
				[first.id, second.id, ended.id].sort()
			);
			expect(mine.find((c) => c.id === first.id)?.status).toBe(
				ConsentStatus.Superseded
			);
			expect(mine.find((c) => c.id === ended.id)?.status).toBe(
				ConsentStatus.Revoked
			);
			expect(await s.consents.listByUser(randomUUID())).toEqual([]);
		});

		it('consent: deleteByUser removes only that user and returns the count', async () => {
			const userId = randomUUID();
			await s.consents.grant(newConsent({ userId }));
			await s.consents.grant(newConsent({ userId }));
			const other = await s.consents.grant(newConsent());

			expect(await s.consents.deleteByUser(userId)).toBe(2);
			expect(await s.consents.deleteByUser(userId)).toBe(0);
			expect(
				(await s.consents.findActiveByRelationship(other.relationshipId))?.id
			).toBe(other.id);
		});
	});
}

export interface AdvisorPortfolioStores {
	transactions: TransactionStorePort;
	targets: AllocationTargetStorePort;
}

const newTx = (
	orgId: string,
	clientProfileId: string,
	overrides: Partial<NewTransaction> = {}
): NewTransaction => ({
	orgId,
	clientProfileId,
	symbol: 'PETR4',
	assetClass: AssetClass.Stock,
	side: TransactionSide.Buy,
	quantity: 10,
	unitPriceMinor: 3500,
	feesMinor: 100,
	currency: 'BRL',
	tradeDate: '2026-01-10',
	provenance: Provenance.Manual,
	source: TransactionSource.ManualEntry,
	createdByUserId: 'u1',
	...overrides,
});

/**
 * Suíte de contrato dos ports de carteira (transações e meta de alocação).
 * Roda contra qualquer implementação (em memória, Mongo); ids aleatórios por
 * teste, sem exigir coleção limpa.
 */
export function describeAdvisorPortfolioStoreContract(
	name: string,
	makeStores: () => AdvisorPortfolioStores
): void {
	describe(`${name} - advisor portfolio store contract`, () => {
		let s: AdvisorPortfolioStores;
		beforeEach(() => {
			s = makeStores();
		});

		it('transactions: createMany returns an empty array for empty input', async () => {
			expect(await s.transactions.createMany([])).toEqual([]);
		});

		it('transactions: createMany/listByClient round trip, ordered by tradeDate then createdAt, distinct ids', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const [late] = await s.transactions.createMany([
				newTx(orgId, clientId, { tradeDate: '2026-03-01', symbol: 'LATE' }),
			]);
			await tick();
			const [earlyFirst] = await s.transactions.createMany([
				newTx(orgId, clientId, { tradeDate: '2026-01-01', symbol: 'E1' }),
			]);
			await tick();
			const [earlySecond] = await s.transactions.createMany([
				newTx(orgId, clientId, { tradeDate: '2026-01-01', symbol: 'E2' }),
			]);

			expect(late.id).toBeTruthy();
			expect(late.createdAt).toBeInstanceOf(Date);
			expect(new Set([late.id, earlyFirst.id, earlySecond.id]).size).toBe(3);
			expect(await s.transactions.listByClient(orgId, clientId)).toEqual([
				earlyFirst,
				earlySecond,
				late,
			]);
		});

		it('transactions: isolates by org (list, findById, deleteById)', async () => {
			const orgA = randomUUID();
			const orgB = randomUUID();
			const clientId = randomUUID();
			const [tx] = await s.transactions.createMany([newTx(orgA, clientId)]);

			expect(await s.transactions.listByClient(orgB, clientId)).toEqual([]);
			expect(await s.transactions.findById(orgB, clientId, tx.id)).toBeNull();
			expect(await s.transactions.deleteById(orgB, clientId, tx.id)).toBe(
				false
			);
			expect(await s.transactions.findById(orgA, clientId, tx.id)).toEqual(tx);
		});

		it('transactions: isolates by client within the same org', async () => {
			const orgId = randomUUID();
			const [tx] = await s.transactions.createMany([
				newTx(orgId, randomUUID()),
			]);
			const otherClient = randomUUID();

			expect(await s.transactions.listByClient(orgId, otherClient)).toEqual([]);
			expect(
				await s.transactions.findById(orgId, otherClient, tx.id)
			).toBeNull();
			expect(await s.transactions.deleteById(orgId, otherClient, tx.id)).toBe(
				false
			);
			expect(
				await s.transactions.findById(orgId, tx.clientProfileId, tx.id)
			).toEqual(tx);
		});

		it('transactions: rows of one createMany with the same tradeDate keep the order they were passed', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const symbols = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];
			await s.transactions.createMany(
				symbols.map((symbol) =>
					newTx(orgId, clientId, { tradeDate: '2026-02-02', symbol })
				)
			);

			const listed = await s.transactions.listByClient(orgId, clientId);
			expect(listed.map((t) => t.symbol)).toEqual(symbols);
		});

		it('transactions: deleteById removes the record; unknown or malformed id gives false', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const [tx] = await s.transactions.createMany([newTx(orgId, clientId)]);

			expect(
				await s.transactions.deleteById(orgId, clientId, randomUUID())
			).toBe(false);
			expect(
				await s.transactions.deleteById(orgId, clientId, 'not-an-object-id')
			).toBe(false);
			expect(await s.transactions.deleteById(orgId, clientId, '')).toBe(false);
			expect(await s.transactions.deleteById(orgId, clientId, tx.id)).toBe(
				true
			);
			expect(await s.transactions.findById(orgId, clientId, tx.id)).toBeNull();
			expect(await s.transactions.deleteById(orgId, clientId, tx.id)).toBe(
				false
			);
		});

		it('transactions: claimImport rejects a duplicate hash for the same client', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const hash = randomUUID();
			const batchId = await s.transactions.claimImport(
				orgId,
				clientId,
				hash,
				'u1'
			);
			expect(batchId).toBeTruthy();
			await expect(
				s.transactions.claimImport(orgId, clientId, hash, 'u1')
			).rejects.toBeInstanceOf(DuplicateImportError);
		});

		it('transactions: claimImport accepts the same hash for another client or org', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const hash = randomUUID();
			await s.transactions.claimImport(orgId, clientId, hash, 'u1');

			await expect(
				s.transactions.claimImport(orgId, randomUUID(), hash, 'u1')
			).resolves.toBeTruthy();
			await expect(
				s.transactions.claimImport(randomUUID(), clientId, hash, 'u1')
			).resolves.toBeTruthy();
		});

		it('transactions: discardImport deletes only that batch and releases the hash', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const hash = randomUUID();
			const batchId = await s.transactions.claimImport(
				orgId,
				clientId,
				hash,
				'u1'
			);
			const [kept] = await s.transactions.createMany([
				newTx(orgId, clientId, { symbol: 'KEEP' }),
			]);
			await s.transactions.createMany([
				newTx(orgId, clientId, {
					symbol: 'B1',
					source: TransactionSource.CsvImport,
					importBatchId: batchId,
				}),
				newTx(orgId, clientId, {
					symbol: 'B2',
					source: TransactionSource.CsvImport,
					importBatchId: batchId,
				}),
			]);
			expect(await s.transactions.listByClient(orgId, clientId)).toHaveLength(
				3
			);

			await s.transactions.discardImport(orgId, clientId, batchId);

			expect(await s.transactions.listByClient(orgId, clientId)).toEqual([
				kept,
			]);
			await expect(
				s.transactions.claimImport(orgId, clientId, hash, 'u1')
			).resolves.toBeTruthy();
		});

		it('transactions: discardImport with another org or client is a no-op', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const hash = randomUUID();
			const batchId = await s.transactions.claimImport(
				orgId,
				clientId,
				hash,
				'u1'
			);
			await s.transactions.createMany([
				newTx(orgId, clientId, {
					source: TransactionSource.CsvImport,
					importBatchId: batchId,
				}),
			]);

			await s.transactions.discardImport(randomUUID(), clientId, batchId);
			await s.transactions.discardImport(orgId, randomUUID(), batchId);

			expect(await s.transactions.listByClient(orgId, clientId)).toHaveLength(
				1
			);
			await expect(
				s.transactions.claimImport(orgId, clientId, hash, 'u1')
			).rejects.toBeInstanceOf(DuplicateImportError);
		});

		it('transactions: discardImport leaves the rows of another batch untouched', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const batchA = await s.transactions.claimImport(
				orgId,
				clientId,
				randomUUID(),
				'u1'
			);
			const batchB = await s.transactions.claimImport(
				orgId,
				clientId,
				randomUUID(),
				'u1'
			);
			await s.transactions.createMany([
				newTx(orgId, clientId, {
					symbol: 'A1',
					source: TransactionSource.CsvImport,
					importBatchId: batchA,
				}),
			]);
			const [keptB] = await s.transactions.createMany([
				newTx(orgId, clientId, {
					symbol: 'B1',
					source: TransactionSource.CsvImport,
					importBatchId: batchB,
				}),
			]);

			await s.transactions.discardImport(orgId, clientId, batchA);

			expect(await s.transactions.listByClient(orgId, clientId)).toEqual([
				keptB,
			]);
		});

		describe('transactions: stale PENDING import takeover', () => {
			const MINUTE = 60_000;
			const claimAt = (
				orgId: string,
				clientId: string,
				hash: string,
				now: Date
			): Promise<string> =>
				s.transactions.claimImport(orgId, clientId, hash, 'u1', now);

			it('a PENDING batch older than 10 minutes is discarded and claimed again with a new id', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const hash = randomUUID();
				const base = new Date();
				const oldBatch = await claimAt(orgId, clientId, hash, base);
				const [kept] = await s.transactions.createMany([
					newTx(orgId, clientId, { symbol: 'KEEP' }),
				]);
				await s.transactions.createMany([
					newTx(orgId, clientId, {
						symbol: 'PART',
						source: TransactionSource.CsvImport,
						importBatchId: oldBatch,
					}),
				]);

				const newBatch = await claimAt(
					orgId,
					clientId,
					hash,
					new Date(base.getTime() + 11 * MINUTE)
				);

				expect(newBatch).toBeTruthy();
				expect(newBatch).not.toBe(oldBatch);
				expect(await s.transactions.listByClient(orgId, clientId)).toEqual([
					kept,
				]);
			});

			it('a PENDING batch younger than 10 minutes is still a duplicate', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const hash = randomUUID();
				const base = new Date();
				await claimAt(orgId, clientId, hash, base);

				await expect(
					claimAt(orgId, clientId, hash, new Date(base.getTime() + MINUTE))
				).rejects.toBeInstanceOf(DuplicateImportError);
			});

			it('a COMPLETED batch is a duplicate however old it is', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const hash = randomUUID();
				const base = new Date();
				const batchId = await claimAt(orgId, clientId, hash, base);
				await s.transactions.completeImport(orgId, clientId, batchId);

				await expect(
					claimAt(orgId, clientId, hash, new Date(base.getTime() + 11 * MINUTE))
				).rejects.toBeInstanceOf(DuplicateImportError);
			});

			it('completeImport with another org or client is a no-op (batch stays PENDING)', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const hash = randomUUID();
				const base = new Date();
				const batchId = await claimAt(orgId, clientId, hash, base);

				await s.transactions.completeImport(randomUUID(), clientId, batchId);
				await s.transactions.completeImport(orgId, randomUUID(), batchId);

				// Ainda PENDING: a retomada depois de 10 minutos funciona.
				await expect(
					claimAt(orgId, clientId, hash, new Date(base.getTime() + 11 * MINUTE))
				).resolves.toBeTruthy();
			});
		});

		it('transactions: concurrent claimImport of the same hash fulfils exactly once', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const hash = randomUUID();

			const results = await Promise.allSettled(
				[1, 2, 3].map(() =>
					s.transactions.claimImport(orgId, clientId, hash, 'u1')
				)
			);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === 'rejected'
			);
			expect(rejected).toHaveLength(2);
			for (const r of rejected) {
				expect(r.reason).toBeInstanceOf(DuplicateImportError);
			}
		});

		it('targets: upsert twice keeps a single record, last value wins', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			await s.targets.upsert({
				orgId,
				clientProfileId: clientId,
				targets: { [AssetClass.Stock]: 60, [AssetClass.Fii]: 40 },
				updatedByUserId: 'u1',
			});
			const second = await s.targets.upsert({
				orgId,
				clientProfileId: clientId,
				targets: { [AssetClass.Stock]: 100 },
				updatedByUserId: 'u2',
			});

			expect(second.updatedAt).toBeInstanceOf(Date);
			const found = await s.targets.find(orgId, clientId);
			expect(found).toEqual(second);
			expect(found?.targets).toEqual({ [AssetClass.Stock]: 100 });
			expect(found?.updatedByUserId).toBe('u2');
		});

		it('targets: concurrent first upserts all fulfil and leave a single record', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const submitted = [10, 20, 30, 40, 50].map((pct) => ({
				[AssetClass.Stock]: pct,
			}));

			const results = await Promise.allSettled(
				submitted.map((targets, i) =>
					s.targets.upsert({
						orgId,
						clientProfileId: clientId,
						targets,
						updatedByUserId: `u${i}`,
					})
				)
			);

			expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
			const found = await s.targets.find(orgId, clientId);
			expect(submitted).toContainEqual(found?.targets);
		});

		it('targets: find is isolated by org and client', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			await s.targets.upsert({
				orgId,
				clientProfileId: clientId,
				targets: { [AssetClass.Stock]: 100 },
				updatedByUserId: 'u1',
			});

			expect(await s.targets.find(randomUUID(), clientId)).toBeNull();
			expect(await s.targets.find(orgId, randomUUID())).toBeNull();
		});
	});
}

/**
 * Suíte de contrato do port de liberação do portal (P3a, U6). Ids aleatórios
 * por teste; não assume coleção vazia, então a listagem é filtrada pelos ids
 * do próprio teste.
 */
export function describeAdvisorPortalGrantStoreContract(
	name: string,
	makeStore: () => PortalGrantStorePort
): void {
	describe(`${name} - advisor portal grant store contract`, () => {
		let store: PortalGrantStorePort;
		const mine = async (userIds: string[]) =>
			(await store.listActive()).filter((g) => userIds.includes(g.userId));

		beforeEach(() => {
			store = makeStore();
		});

		it('grant/findActive round trip; unknown user gives null', async () => {
			const userId = randomUUID();
			const at = new Date('2026-11-20T10:00:00.000Z');
			const created = await store.grant(userId, 'admin-1', at);
			expect(created).toEqual({
				id: expect.any(String),
				userId,
				grantedBy: 'admin-1',
				grantedAt: at,
			});
			expect(await store.findActive(userId)).toEqual(created);
			expect(await store.findActive(randomUUID())).toBeNull();
		});

		it('granting again returns the active grant instead of a second one', async () => {
			const userId = randomUUID();
			const first = await store.grant(userId, 'admin-1', new Date());
			const again = await store.grant(userId, 'admin-2', new Date());
			expect(again).toEqual(first);
			expect(await mine([userId])).toEqual([first]);
		});

		it('concurrent grants for the same user leave one active grant', async () => {
			const userId = randomUUID();
			const results = await Promise.all(
				[1, 2, 3].map((n) => store.grant(userId, `admin-${n}`, new Date()))
			);
			expect(new Set(results.map((g) => g.id)).size).toBe(1);
			expect(await mine([userId])).toHaveLength(1);
		});

		it('revoke ends the active grant once; a later grant is a new one', async () => {
			const userId = randomUUID();
			const first = await store.grant(userId, 'admin-1', new Date());
			const at = new Date('2026-11-21T10:00:00.000Z');

			expect(await store.revoke(userId, at)).toBe(true);
			expect(await store.findActive(userId)).toBeNull();
			expect(await mine([userId])).toEqual([]);
			expect(await store.revoke(userId, at)).toBe(false);

			const second = await store.grant(userId, 'admin-1', new Date());
			expect(second.id).not.toBe(first.id);
			expect(second.revokedAt).toBeUndefined();
			expect(await store.findActive(userId)).toEqual(second);
		});

		it('revoking an unknown user is false', async () => {
			expect(await store.revoke(randomUUID(), new Date())).toBe(false);
		});

		it('listActive holds only the active grants', async () => {
			const kept = randomUUID();
			const gone = randomUUID();
			const keptGrant = await store.grant(kept, 'admin-1', new Date());
			await store.grant(gone, 'admin-1', new Date());
			await store.revoke(gone, new Date());
			expect(await mine([kept, gone])).toEqual([keptGrant]);
		});
	});
}

export interface AdvisorTeamStores {
	assignments: AssignmentStorePort;
	memberInvites: MemberInviteStorePort;
	memberships: MembershipStorePort;
	relationships: RelationshipStorePort;
	profiles: ClientProfileStorePort;
}

/**
 * Suíte de contrato dos stores da equipe: atribuição, convite de membro e os
 * métodos novos de vínculo, relação e perfil. Ids aleatórios por teste.
 */
export function describeAdvisorTeamStoreContract(
	name: string,
	makeStores: () => AdvisorTeamStores
): void {
	describe(`${name} - advisor team store contract`, () => {
		let s: AdvisorTeamStores;
		beforeEach(() => {
			s = makeStores();
		});

		const FUTURE = new Date('2030-01-01T00:00:00Z');
		const NOW = new Date('2029-01-01T00:00:00Z');

		const newInvite = (
			overrides: Partial<Omit<MemberInvite, 'id' | 'createdAt'>> = {}
		): Omit<MemberInvite, 'id' | 'createdAt'> => ({
			orgId: randomUUID(),
			email: `${randomUUID()}@example.com`,
			role: OrgRole.Advisor,
			tokenHash: randomUUID(),
			status: MemberInviteStatus.Pending,
			expiresAt: FUTURE,
			resendCount: 0,
			invitedByUserId: randomUUID(),
			...overrides,
		});

		describe('assignments', () => {
			it('assign is idempotent: repeating keeps one row with the first assignedBy', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const userId = randomUUID();
				const first = await s.assignments.assign(orgId, clientId, userId, 'a1');
				const again = await s.assignments.assign(orgId, clientId, userId, 'a2');

				expect(again).toEqual(first);
				expect(first).toEqual({
					id: expect.any(String),
					orgId,
					clientProfileId: clientId,
					userId,
					assignedBy: 'a1',
					createdAt: expect.any(Date),
				});
				expect(await s.assignments.listByClient(orgId, clientId)).toEqual([
					first,
				]);
			});

			it('concurrent assigns of the same trio leave one row', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const userId = randomUUID();
				const results = await Promise.all(
					[1, 2, 3, 4].map((n) =>
						s.assignments.assign(orgId, clientId, userId, `a${n}`)
					)
				);
				expect(new Set(results.map((r) => r.id)).size).toBe(1);
				expect(await s.assignments.listByClient(orgId, clientId)).toHaveLength(
					1
				);
			});

			it('unassign removes once; an unknown assignment gives false', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const userId = randomUUID();
				expect(await s.assignments.unassign(orgId, clientId, userId)).toBe(
					false
				);
				await s.assignments.assign(orgId, clientId, userId, 'a1');
				expect(await s.assignments.isAssigned(orgId, clientId, userId)).toBe(
					true
				);
				expect(await s.assignments.unassign(orgId, clientId, userId)).toBe(
					true
				);
				expect(await s.assignments.isAssigned(orgId, clientId, userId)).toBe(
					false
				);
				expect(await s.assignments.unassign(orgId, clientId, userId)).toBe(
					false
				);
			});

			it('isAssigned is scoped by org, client and user', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const userId = randomUUID();
				await s.assignments.assign(orgId, clientId, userId, 'a1');
				expect(
					await s.assignments.isAssigned(randomUUID(), clientId, userId)
				).toBe(false);
				expect(
					await s.assignments.isAssigned(orgId, randomUUID(), userId)
				).toBe(false);
				expect(
					await s.assignments.isAssigned(orgId, clientId, randomUUID())
				).toBe(false);
			});

			it('listByClient returns every advisor of that client in creation order', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const first = await s.assignments.assign(orgId, clientId, 'u1', 'a');
				await tick();
				const second = await s.assignments.assign(orgId, clientId, 'u2', 'a');
				await s.assignments.assign(randomUUID(), clientId, 'u3', 'a');
				await s.assignments.assign(orgId, randomUUID(), 'u4', 'a');

				expect(await s.assignments.listByClient(orgId, clientId)).toEqual([
					first,
					second,
				]);
			});

			it('listClientIdsByUser pages 5 clients with limit 2 without repeats; other orgs and users do not show', async () => {
				const orgId = randomUUID();
				const userId = randomUUID();
				const clients = [1, 2, 3, 4, 5].map(() => randomUUID());
				for (const c of clients) {
					await s.assignments.assign(orgId, c, userId, 'a');
					await tick();
				}
				await s.assignments.assign(randomUUID(), randomUUID(), userId, 'a');
				await s.assignments.assign(orgId, randomUUID(), randomUUID(), 'a');

				const seen: string[] = [];
				let cursor: string | undefined;
				let pages = 0;
				do {
					const page = await s.assignments.listClientIdsByUser(orgId, userId, {
						cursor,
						limit: 2,
					});
					seen.push(...page.ids);
					cursor = page.nextCursor ?? undefined;
					pages += 1;
				} while (cursor);

				expect(seen).toEqual(clients);
				expect(pages).toBe(3);
			});

			it('listClientIdsByUser: the last page has no cursor and an exact fit does not invent one', async () => {
				const orgId = randomUUID();
				const userId = randomUUID();
				await s.assignments.assign(orgId, randomUUID(), userId, 'a');
				await tick();
				await s.assignments.assign(orgId, randomUUID(), userId, 'a');
				const page = await s.assignments.listClientIdsByUser(orgId, userId, {
					limit: 2,
				});
				expect(page.ids).toHaveLength(2);
				expect(page.nextCursor).toBeNull();
				expect(
					await s.assignments.listClientIdsByUser(orgId, randomUUID(), {
						limit: 2,
					})
				).toEqual({ ids: [], nextCursor: null });
			});

			it('listClientIdsByUser keeps paging when the last item seen is deleted', async () => {
				const orgId = randomUUID();
				const userId = randomUUID();
				const clients = [1, 2, 3, 4].map(() => randomUUID());
				for (const c of clients) {
					await s.assignments.assign(orgId, c, userId, 'a');
					await tick();
				}
				const first = await s.assignments.listClientIdsByUser(orgId, userId, {
					limit: 2,
				});
				expect(first.ids).toEqual(clients.slice(0, 2));
				await s.assignments.unassign(orgId, clients[1], userId);

				const second = await s.assignments.listClientIdsByUser(orgId, userId, {
					cursor: first.nextCursor as string,
					limit: 2,
				});
				expect(second.ids).toEqual(clients.slice(2));
				expect(second.nextCursor).toBeNull();
			});

			it('listClientIdsByUser rejects a cursor that is not ours', async () => {
				await expect(
					s.assignments.listClientIdsByUser(randomUUID(), randomUUID(), {
						cursor: 'not-a-cursor',
						limit: 2,
					})
				).rejects.toBeInstanceOf(InvalidCursorError);
			});

			it('deleteByUser only touches that user in that org', async () => {
				const orgId = randomUUID();
				const otherOrg = randomUUID();
				const userId = randomUUID();
				const clientA = randomUUID();
				const clientB = randomUUID();
				await s.assignments.assign(orgId, clientA, userId, 'a');
				await s.assignments.assign(orgId, clientB, userId, 'a');
				await s.assignments.assign(otherOrg, clientA, userId, 'a');
				await s.assignments.assign(orgId, clientA, 'other-user', 'a');

				expect(await s.assignments.deleteByUser(orgId, userId)).toBe(2);
				expect(await s.assignments.deleteByUser(orgId, userId)).toBe(0);
				expect(await s.assignments.isAssigned(otherOrg, clientA, userId)).toBe(
					true
				);
				expect(
					await s.assignments.isAssigned(orgId, clientA, 'other-user')
				).toBe(true);
			});

			it('deleteAllForUser clears the user in every org and leaves others', async () => {
				const userId = randomUUID();
				const clientId = randomUUID();
				const orgA = randomUUID();
				const orgB = randomUUID();
				await s.assignments.assign(orgA, clientId, userId, 'a');
				await s.assignments.assign(orgB, clientId, userId, 'a');
				await s.assignments.assign(orgA, clientId, 'other-user', 'a');

				expect(await s.assignments.deleteAllForUser(userId)).toBe(2);
				expect(await s.assignments.deleteAllForUser(userId)).toBe(0);
				expect(await s.assignments.listByClient(orgA, clientId)).toHaveLength(
					1
				);
			});

			it('deleteByClient clears every advisor of that client in that org only', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				await s.assignments.assign(orgId, clientId, 'u1', 'a');
				await s.assignments.assign(orgId, clientId, 'u2', 'a');
				await s.assignments.assign(randomUUID(), clientId, 'u1', 'a');
				await s.assignments.assign(orgId, randomUUID(), 'u1', 'a');

				expect(await s.assignments.deleteByClient(orgId, clientId)).toBe(2);
				expect(await s.assignments.listByClient(orgId, clientId)).toEqual([]);
				expect(await s.assignments.deleteByClient(orgId, clientId)).toBe(0);
			});
		});

		describe('member invites', () => {
			it('create round trips by id and token hash, keeping the role; other org gives null', async () => {
				const created = await s.memberInvites.create(newInvite());

				expect(created).toMatchObject({
					id: expect.any(String),
					role: OrgRole.Advisor,
					status: MemberInviteStatus.Pending,
					resendCount: 0,
				});
				expect(created.createdAt).toBeInstanceOf(Date);
				expect(created.respondedAt).toBeUndefined();
				expect(
					await s.memberInvites.findById(created.orgId, created.id)
				).toEqual(created);
				expect(
					await s.memberInvites.findById(randomUUID(), created.id)
				).toBeNull();
				expect(
					await s.memberInvites.findById(created.orgId, 'nope')
				).toBeNull();
				expect(
					await s.memberInvites.findByTokenHash(created.tokenHash)
				).toEqual(created);
				expect(await s.memberInvites.findByTokenHash('unknown')).toBeNull();
			});

			it('a second PENDING invite for the same email in the same org is rejected', async () => {
				const first = await s.memberInvites.create(newInvite());
				await expect(
					s.memberInvites.create(
						newInvite({ orgId: first.orgId, email: first.email })
					)
				).rejects.toBeInstanceOf(DuplicatePendingMemberInviteError);
			});

			it('the same email can be invited by another org', async () => {
				const first = await s.memberInvites.create(newInvite());
				await expect(
					s.memberInvites.create(newInvite({ email: first.email }))
				).resolves.toBeTruthy();
			});

			it('a new invite is allowed once the previous one left PENDING', async () => {
				const first = await s.memberInvites.create(newInvite());
				await s.memberInvites.transition(
					first.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Declined,
					NOW
				);
				const second = await s.memberInvites.create(
					newInvite({ orgId: first.orgId, email: first.email })
				);
				expect(second.id).not.toBe(first.id);
			});

			it('transition: concurrent calls leave exactly one winner', async () => {
				const invite = await s.memberInvites.create(newInvite());
				const results = await Promise.allSettled(
					[
						MemberInviteStatus.Accepted,
						MemberInviteStatus.Declined,
						MemberInviteStatus.Cancelled,
					].map((to) =>
						s.memberInvites.transition(
							invite.id,
							MemberInviteStatus.Pending,
							to,
							NOW
						)
					)
				);
				const winners = results.filter(
					(r) => r.status === 'fulfilled' && r.value !== null
				);
				expect(winners).toHaveLength(1);
				const stored = await s.memberInvites.findById(invite.orgId, invite.id);
				expect(stored?.status).not.toBe(MemberInviteStatus.Pending);
				expect(stored?.respondedAt).toEqual(NOW);
			});

			it('transition only fires from the expected status', async () => {
				const invite = await s.memberInvites.create(newInvite());
				expect(
					await s.memberInvites.transition(
						invite.id,
						MemberInviteStatus.Expired,
						MemberInviteStatus.Cancelled,
						NOW
					)
				).toBeNull();
				const accepted = await s.memberInvites.transition(
					invite.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Accepted,
					NOW
				);
				expect(accepted).toMatchObject({
					status: MemberInviteStatus.Accepted,
					respondedAt: NOW,
				});
				expect(
					await s.memberInvites.transition(
						invite.id,
						MemberInviteStatus.Pending,
						MemberInviteStatus.Declined,
						NOW
					)
				).toBeNull();
				expect(
					await s.memberInvites.transition(
						randomUUID(),
						MemberInviteStatus.Pending,
						MemberInviteStatus.Declined,
						NOW
					)
				).toBeNull();
			});

			it('rotateToken adds 1 to resendCount, swaps hash and expiry; the old hash stops working', async () => {
				const invite = await s.memberInvites.create(newInvite());
				const later = new Date('2031-01-01T00:00:00Z');
				const rotated = await s.memberInvites.rotateToken(
					invite.id,
					'new-hash',
					later,
					3
				);
				expect(rotated).toMatchObject({
					tokenHash: 'new-hash',
					expiresAt: later,
					resendCount: 1,
				});
				const again = await s.memberInvites.rotateToken(
					invite.id,
					'newer-hash',
					later,
					3
				);
				expect(again?.resendCount).toBe(2);
				expect(
					await s.memberInvites.findByTokenHash(invite.tokenHash)
				).toBeNull();
				expect((await s.memberInvites.findByTokenHash('newer-hash'))?.id).toBe(
					invite.id
				);
			});

			it('rotateToken is null for an unknown or no longer PENDING invite', async () => {
				expect(
					await s.memberInvites.rotateToken(randomUUID(), 'h', FUTURE, 3)
				).toBeNull();
				const invite = await s.memberInvites.create(newInvite());
				await s.memberInvites.transition(
					invite.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Cancelled,
					NOW
				);
				expect(
					await s.memberInvites.rotateToken(invite.id, 'h', FUTURE, 3)
				).toBeNull();
			});

			it('rotateToken stops at max; two concurrent rotates at max - 1 let only one through', async () => {
				const invite = await s.memberInvites.create(newInvite());
				for (let i = 0; i < 2; i++) {
					await s.memberInvites.rotateToken(invite.id, `h${i}`, FUTURE, 3);
				}

				const results = await Promise.allSettled([
					s.memberInvites.rotateToken(invite.id, 'race-a', FUTURE, 3),
					s.memberInvites.rotateToken(invite.id, 'race-b', FUTURE, 3),
				]);

				const won = results.filter(
					(r) => r.status === 'fulfilled' && r.value !== null
				);
				expect(won).toHaveLength(1);
				const stored = await s.memberInvites.findById(invite.orgId, invite.id);
				expect(stored?.resendCount).toBe(3);
				expect(
					await s.memberInvites.rotateToken(invite.id, 'h', FUTURE, 3)
				).toBeNull();
			});

			it('transition back to PENDING clears respondedAt', async () => {
				const invite = await s.memberInvites.create(newInvite());
				await s.memberInvites.transition(
					invite.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Accepted,
					NOW
				);

				const reopened = await s.memberInvites.transition(
					invite.id,
					MemberInviteStatus.Accepted,
					MemberInviteStatus.Pending,
					NOW
				);

				expect(reopened?.status).toBe(MemberInviteStatus.Pending);
				expect(reopened?.respondedAt).toBeUndefined();
				const stored = await s.memberInvites.findById(invite.orgId, invite.id);
				expect(stored?.respondedAt).toBeUndefined();
			});

			it('findPendingByOrgAndEmail ignores expired, answered and other-org invites', async () => {
				const orgId = randomUUID();
				const live = await s.memberInvites.create(newInvite({ orgId }));
				expect(
					(
						await s.memberInvites.findPendingByOrgAndEmail(
							orgId,
							live.email,
							NOW
						)
					)?.id
				).toBe(live.id);
				expect(
					await s.memberInvites.findPendingByOrgAndEmail(
						orgId,
						live.email,
						new Date('2031-01-01T00:00:00Z')
					)
				).toBeNull();
				expect(
					await s.memberInvites.findPendingByOrgAndEmail(
						randomUUID(),
						live.email,
						NOW
					)
				).toBeNull();
				await s.memberInvites.transition(
					live.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Accepted,
					NOW
				);
				expect(
					await s.memberInvites.findPendingByOrgAndEmail(orgId, live.email, NOW)
				).toBeNull();
			});

			it('listPendingByOrg lists live PENDING invites of the org, newest first', async () => {
				const orgId = randomUUID();
				const older = await s.memberInvites.create(newInvite({ orgId }));
				await tick();
				const newer = await s.memberInvites.create(newInvite({ orgId }));
				const answered = await s.memberInvites.create(newInvite({ orgId }));
				await s.memberInvites.transition(
					answered.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Declined,
					NOW
				);
				await s.memberInvites.create(
					newInvite({ orgId, expiresAt: new Date('2028-01-01T00:00:00Z') })
				);
				await s.memberInvites.create(newInvite());

				const listed = await s.memberInvites.listPendingByOrg(orgId, NOW);
				expect(listed.map((i) => i.id)).toEqual([newer.id, older.id]);
			});

			it('deleteById removes just that invite and is silent for an unknown id', async () => {
				const orgId = randomUUID();
				const keep = await s.memberInvites.create(newInvite({ orgId }));
				const drop = await s.memberInvites.create(newInvite({ orgId }));
				await s.memberInvites.deleteById(drop.id);
				await s.memberInvites.deleteById(randomUUID());
				expect(await s.memberInvites.findById(orgId, drop.id)).toBeNull();
				expect(await s.memberInvites.findById(orgId, keep.id)).toEqual(keep);
			});

			it('deletePendingByEmail clears PENDING invites of that email in every org and keeps the answered ones', async () => {
				const email = `${randomUUID()}@example.com`;
				const a = await s.memberInvites.create(newInvite({ email }));
				const b = await s.memberInvites.create(newInvite({ email }));
				const answered = await s.memberInvites.create(newInvite({ email }));
				await s.memberInvites.transition(
					answered.id,
					MemberInviteStatus.Pending,
					MemberInviteStatus.Accepted,
					NOW
				);
				const other = await s.memberInvites.create(newInvite());

				expect(await s.memberInvites.deletePendingByEmail(email)).toBe(2);
				expect(await s.memberInvites.deletePendingByEmail(email)).toBe(0);
				expect(await s.memberInvites.findById(a.orgId, a.id)).toBeNull();
				expect(await s.memberInvites.findById(b.orgId, b.id)).toBeNull();
				expect(
					await s.memberInvites.findById(answered.orgId, answered.id)
				).not.toBeNull();
				expect(
					await s.memberInvites.findById(other.orgId, other.id)
				).not.toBeNull();
			});
		});

		describe('memberships', () => {
			it('delete removes one vínculo once', async () => {
				const userId = randomUUID();
				const orgId = randomUUID();
				await s.memberships.create({ userId, orgId, role: OrgRole.Advisor });
				await s.memberships.create({
					userId,
					orgId: randomUUID(),
					role: OrgRole.Advisor,
				});

				expect(await s.memberships.delete(userId, orgId)).toBe(true);
				expect(await s.memberships.delete(userId, orgId)).toBe(false);
				expect(await s.memberships.findByUserAndOrg(userId, orgId)).toBeNull();
				expect(await s.memberships.findByUser(userId)).toHaveLength(1);
			});

			it('setRole changes only that vínculo; unknown gives null', async () => {
				const userId = randomUUID();
				const orgId = randomUUID();
				const created = await s.memberships.create({
					userId,
					orgId,
					role: OrgRole.Advisor,
				});
				const bystander = await s.memberships.create({
					userId: randomUUID(),
					orgId,
					role: OrgRole.Advisor,
				});

				expect(
					await s.memberships.setRole(userId, orgId, OrgRole.OrgAdmin)
				).toEqual({ ...created, role: OrgRole.OrgAdmin });
				expect(await s.memberships.findByUserAndOrg(userId, orgId)).toEqual({
					...created,
					role: OrgRole.OrgAdmin,
				});
				expect(
					await s.memberships.findByUserAndOrg(bystander.userId, orgId)
				).toEqual(bystander);
				expect(
					await s.memberships.setRole(userId, randomUUID(), OrgRole.OrgAdmin)
				).toBeNull();
			});

			it('listByOrg is isolated by org and in createdAt order', async () => {
				const orgId = randomUUID();
				const first = await s.memberships.create({
					userId: randomUUID(),
					orgId,
					role: OrgRole.OrgAdmin,
				});
				await tick();
				const second = await s.memberships.create({
					userId: randomUUID(),
					orgId,
					role: OrgRole.Advisor,
				});
				await s.memberships.create({
					userId: randomUUID(),
					orgId: randomUUID(),
					role: OrgRole.Advisor,
				});

				expect(await s.memberships.listByOrg(orgId)).toEqual([first, second]);
				expect(await s.memberships.listByOrg(randomUUID())).toEqual([]);
			});

			it('deleteAllForUser clears the user in every org and leaves others', async () => {
				const userId = randomUUID();
				const orgId = randomUUID();
				await s.memberships.create({ userId, orgId, role: OrgRole.Advisor });
				await s.memberships.create({
					userId,
					orgId: randomUUID(),
					role: OrgRole.Advisor,
				});
				await s.memberships.create({
					userId: randomUUID(),
					orgId,
					role: OrgRole.Advisor,
				});

				expect(await s.memberships.deleteAllForUser(userId)).toBe(2);
				expect(await s.memberships.deleteAllForUser(userId)).toBe(0);
				expect(await s.memberships.findByUser(userId)).toEqual([]);
				expect(await s.memberships.listByOrg(orgId)).toHaveLength(1);
			});
		});

		describe('relationships and profiles', () => {
			const relationInOrg = async (
				orgId: string,
				clientProfileId: string,
				status = RelationshipStatus.Active
			) => s.relationships.create({ orgId, clientProfileId, status });

			it('listUnassignedByOrg drops profiles with any assignment, keeps the rest in listByOrg order', async () => {
				const orgId = randomUUID();
				const clients = [1, 2, 3, 4].map(() => randomUUID());
				const rels = [];
				for (const c of clients) {
					rels.push(await relationInOrg(orgId, c));
					await tick();
				}
				await s.assignments.assign(orgId, clients[1], randomUUID(), 'a');
				await s.assignments.assign(orgId, clients[1], randomUUID(), 'a');
				await s.assignments.assign(orgId, clients[2], randomUUID(), 'a');

				const page = await s.relationships.listUnassignedByOrg(orgId, {
					statuses: [RelationshipStatus.Active],
					limit: 10,
				});
				expect(page.items.map((r) => r.id)).toEqual([rels[3].id, rels[0].id]);
				expect(page.nextCursor).toBeNull();
			});

			it('listUnassignedByOrg ignores an assignment made in another org and respects statuses', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const active = await relationInOrg(orgId, clientId);
				const pending = await relationInOrg(
					orgId,
					randomUUID(),
					RelationshipStatus.Pending
				);
				await s.assignments.assign(randomUUID(), clientId, randomUUID(), 'a');

				const onlyActive = await s.relationships.listUnassignedByOrg(orgId, {
					statuses: [RelationshipStatus.Active],
					limit: 10,
				});
				expect(onlyActive.items.map((r) => r.id)).toEqual([active.id]);
				const both = await s.relationships.listUnassignedByOrg(orgId, {
					statuses: [RelationshipStatus.Active, RelationshipStatus.Pending],
					limit: 10,
				});
				expect(both.items.map((r) => r.id).sort()).toEqual(
					[active.id, pending.id].sort()
				);
			});

			it('listUnassignedByOrg pages with limit and cursor without repeats', async () => {
				const orgId = randomUUID();
				const rels = [];
				for (let i = 0; i < 5; i += 1) {
					rels.push(await relationInOrg(orgId, randomUUID()));
					await tick();
				}
				const seen: string[] = [];
				let cursor: string | undefined;
				do {
					const page = await s.relationships.listUnassignedByOrg(orgId, {
						statuses: [RelationshipStatus.Active],
						cursor,
						limit: 2,
					});
					seen.push(...page.items.map((r) => r.id));
					cursor = page.nextCursor ?? undefined;
				} while (cursor);

				expect(seen).toEqual(rels.map((r) => r.id).reverse());
			});

			it('listUnassignedByOrg: a profile becomes listed again once unassigned', async () => {
				const orgId = randomUUID();
				const clientId = randomUUID();
				const userId = randomUUID();
				const rel = await relationInOrg(orgId, clientId);
				await s.assignments.assign(orgId, clientId, userId, 'a');
				const query = { statuses: [RelationshipStatus.Active], limit: 10 };
				expect(
					(await s.relationships.listUnassignedByOrg(orgId, query)).items
				).toEqual([]);
				await s.assignments.unassign(orgId, clientId, userId);
				expect(
					(await s.relationships.listUnassignedByOrg(orgId, query)).items
				).toEqual([rel]);
			});

			it('relationship deleteById removes it and is silent for an unknown id', async () => {
				const rel = await relationInOrg(randomUUID(), randomUUID());
				await s.relationships.deleteById(rel.id);
				await s.relationships.deleteById(randomUUID());
				expect(await s.relationships.findById(rel.id)).toBeNull();
			});

			it('profile deleteById removes it and is silent for an unknown id', async () => {
				const profile = await s.profiles.create({
					orgId: randomUUID(),
					name: 'Gone',
					origin: ProfileOrigin.AdvisorCreated,
				});
				await s.profiles.deleteById(profile.id);
				await s.profiles.deleteById(randomUUID());
				expect(await s.profiles.findById(profile.id)).toBeNull();
			});
		});
	});
}
