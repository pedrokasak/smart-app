import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { InviteStatus, OrgRole, ProfileOrigin } from '../domain/enums';
import { RelationshipStatus } from '../domain/enums';
import { AuthorizationService } from './authorization.service';
import { ClientDirectoryService } from './client-directory.service';
import { ClientProfileService } from './client-profile.service';
import {
	InMemoryClientProfileStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { RelationshipService } from './relationship.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}
}

describe('ClientDirectoryService', () => {
	const ctx = { userId: 'user-1', orgId: 'orgA' };
	let memberships: InMemoryMembershipStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let invites: InMemoryInviteStore;
	let audit: FakeAuditTrail;
	let svc: ClientDirectoryService;

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		relationships = new InMemoryRelationshipStore();
		profiles = new InMemoryClientProfileStore();
		invites = new InMemoryInviteStore();
		audit = new FakeAuditTrail();
		svc = new ClientDirectoryService(
			new AuthorizationService(memberships, relationships, profiles, audit),
			new ClientProfileService(profiles),
			new RelationshipService(relationships),
			relationships,
			profiles,
			invites,
			audit
		);
		await memberships.create({
			userId: ctx.userId,
			orgId: 'orgA',
			role: OrgRole.Advisor,
		});
	});

	const addClient = async (
		orgId: string,
		name: string,
		status: RelationshipStatus,
		origin = ProfileOrigin.AdvisorCreated
	) => {
		const profile = profiles.seed({
			id: `p-${name}`,
			orgId,
			name,
			origin,
		});
		const relationship = await relationships.create({
			orgId,
			clientProfileId: profile.id,
			status,
		});
		return { profile, relationship };
	};

	describe('listClients', () => {
		it('lists ACTIVE and PENDING for OPEN, REVOKED for REVOKED, and nothing from another org', async () => {
			await addClient('orgA', 'ana', RelationshipStatus.Active);
			await addClient('orgA', 'bia', RelationshipStatus.Pending);
			await addClient('orgA', 'caio', RelationshipStatus.Revoked);
			await addClient('orgB', 'duda', RelationshipStatus.Active);
			// perfil sem relação com a org
			profiles.seed({
				id: 'solto',
				orgId: 'orgA',
				name: 'solto',
				origin: ProfileOrigin.AdvisorCreated,
			});

			const open = await svc.listClients(ctx, { status: 'OPEN', limit: 50 });
			const revoked = await svc.listClients(ctx, {
				status: 'REVOKED',
				limit: 50,
			});

			expect(open.items.map((c) => c.name).sort()).toEqual(['ana', 'bia']);
			expect(open.nextCursor).toBeNull();
			expect(revoked.items.map((c) => c.name)).toEqual(['caio']);
		});

		it('maps origin, status and hasSharedPortfolios (ACTIVE with consent only)', async () => {
			const { relationship } = await addClient(
				'orgA',
				'ana',
				RelationshipStatus.Active,
				ProfileOrigin.ClientCreated
			);
			await relationships.setConsentIfActive(relationship.id, 'consent-1');
			await addClient('orgA', 'bia', RelationshipStatus.Active);

			const { items } = await svc.listClients(ctx, {
				status: 'OPEN',
				limit: 50,
			});

			const ana = items.find((c) => c.name === 'ana');
			const bia = items.find((c) => c.name === 'bia');
			expect(ana).toEqual({
				id: 'p-ana',
				name: 'ana',
				origin: ProfileOrigin.ClientCreated,
				relationshipStatus: RelationshipStatus.Active,
				hasSharedPortfolios: true,
			});
			expect(bia?.hasSharedPortfolios).toBe(false);
		});

		it('paginates with the cursor', async () => {
			await addClient('orgA', 'ana', RelationshipStatus.Active);
			await addClient('orgA', 'bia', RelationshipStatus.Active);
			await addClient('orgA', 'caio', RelationshipStatus.Active);

			const first = await svc.listClients(ctx, { status: 'OPEN', limit: 2 });
			expect(first.items).toHaveLength(2);
			expect(first.nextCursor).not.toBeNull();
			const second = await svc.listClients(ctx, {
				status: 'OPEN',
				limit: 2,
				cursor: first.nextCursor!,
			});
			expect(second.items).toHaveLength(1);
			expect(second.nextCursor).toBeNull();
		});

		it('propagates an invalid cursor error', async () => {
			await expect(
				svc.listClients(ctx, { status: 'OPEN', limit: 2, cursor: '!!!' })
			).rejects.toMatchObject({ name: 'InvalidCursorError' });
		});
	});

	describe('createClient', () => {
		it('creates an ADVISOR_CREATED profile with an ACTIVE relationship and audits ids only', async () => {
			const created = await svc.createClient(ctx, { name: 'Maria Silva' });

			expect(created).toMatchObject({
				name: 'Maria Silva',
				origin: ProfileOrigin.AdvisorCreated,
				relationshipStatus: RelationshipStatus.Active,
				hasSharedPortfolios: false,
			});
			expect(
				await relationships.findByOrgAndClient('orgA', created.id)
			).toMatchObject({ status: RelationshipStatus.Active });
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0]).toMatchObject({
				type: 'advisor.client.created',
				version: 1,
				subject: created.id,
				actorRef: actorRefOf(ctx.userId),
				payload: { orgId: 'orgA', clientProfileId: created.id },
			});
			expect(JSON.stringify(audit.recorded[0])).not.toContain('Maria');
		});

		it('keeps the client and relationship and throws when the audit fails', async () => {
			audit.failWith = new Error('audit down');

			await expect(svc.createClient(ctx, { name: 'Maria' })).rejects.toThrow(
				'audit down'
			);

			const { items } = await svc.listClients(ctx, {
				status: 'OPEN',
				limit: 10,
			});
			expect(items.map((c) => c.name)).toEqual(['Maria']);
		});
	});

	describe('getClient', () => {
		it('returns the summary of an accessible client and audits the access', async () => {
			await addClient('orgA', 'ana', RelationshipStatus.Active);

			const client = await svc.getClient(ctx, 'p-ana');

			expect(client).toMatchObject({ id: 'p-ana', name: 'ana' });
			expect(audit.recorded.map((e) => e.type)).toEqual([
				'advisor.client.accessed',
			]);
		});

		it('refuses a client of another org', async () => {
			await addClient('orgB', 'duda', RelationshipStatus.Active);
			await expect(svc.getClient(ctx, 'p-duda')).rejects.toMatchObject({
				reason: 'CLIENT_NOT_ACCESSIBLE',
			});
		});
	});

	describe('listPendingInvites', () => {
		it('lists pending invites of the org with masked e-mail and client name', async () => {
			const { profile, relationship } = await addClient(
				'orgA',
				'ana',
				RelationshipStatus.Pending,
				ProfileOrigin.ClientCreated
			);
			const invite = await invites.create({
				orgId: 'orgA',
				clientProfileId: profile.id,
				relationshipId: relationship.id,
				email: 'joao@exemplo.com',
				tokenHash: 'h1',
				status: InviteStatus.Pending,
				expiresAt: new Date(Date.now() + 3600_000),
				resendCount: 1,
				invitedByUserId: ctx.userId,
			});
			await invites.create({
				orgId: 'orgB',
				clientProfileId: 'other',
				relationshipId: 'r',
				email: 'x@y.com',
				tokenHash: 'h2',
				status: InviteStatus.Pending,
				expiresAt: new Date(Date.now() + 3600_000),
				resendCount: 0,
				invitedByUserId: 'z',
			});

			const list = await svc.listPendingInvites(ctx);

			expect(list).toEqual([
				{
					id: invite.id,
					clientProfileId: profile.id,
					clientName: 'ana',
					invitedEmailMasked: 'jo***@ex***.com',
					expiresAt: invite.expiresAt,
					resendCount: 1,
				},
			]);
			expect(JSON.stringify(list)).not.toContain('joao@exemplo.com');
		});
	});

	describe('non member', () => {
		const stranger = { userId: 'stranger', orgId: 'orgA' };

		it('is refused by every operation', async () => {
			await addClient('orgA', 'ana', RelationshipStatus.Active);
			const calls = [
				() => svc.listClients(stranger, { status: 'OPEN', limit: 10 }),
				() => svc.createClient(stranger, { name: 'Maria' }),
				() => svc.getClient(stranger, 'p-ana'),
				() => svc.listPendingInvites(stranger),
			];
			for (const call of calls) {
				await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
			}
			expect(audit.recorded).toEqual([]);
			expect(
				(await svc.listClients(ctx, { status: 'OPEN', limit: 10 })).items
			).toHaveLength(1);
		});
	});
});
