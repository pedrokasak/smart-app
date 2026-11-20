import { randomUUID } from 'crypto';
import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisorType,
	AssetClass,
	ConsentStatus,
	InviteStatus,
	OrgRole,
	ProfileOrigin,
	Provenance,
	RelationshipStatus,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';
import { NewTransaction } from '../domain/portfolio.entities';
import { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ConsentStorePort } from './ports/consent.store.port';
import { InviteStorePort } from './ports/invite.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { RelationshipStorePort } from './ports/relationship.store.port';
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

		it('invite: deleteByEmail removes only that e-mail and returns the count', async () => {
			const email = `${randomUUID()}@example.com`;
			await s.invites.create(newInvite({ email }));
			await s.invites.create(newInvite({ email }));
			const other = await s.invites.create(newInvite());

			expect(await s.invites.deleteByEmail(email)).toBe(2);
			expect(await s.invites.deleteByEmail(email)).toBe(0);
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
