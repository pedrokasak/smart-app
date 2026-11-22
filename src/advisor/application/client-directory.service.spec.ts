import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { InviteStatus, OrgRole, ProfileOrigin } from '../domain/enums';
import { RelationshipStatus } from '../domain/enums';
import { AuthorizationService } from './authorization.service';
import {
	AssigneeFilterForbiddenError,
	ClientDirectoryService,
} from './client-directory.service';
import { ClientProfileService } from './client-profile.service';
import {
	InMemoryAssignmentStore,
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
	let assignments: InMemoryAssignmentStore;
	let audit: FakeAuditTrail;
	let svc: ClientDirectoryService;

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		profiles = new InMemoryClientProfileStore();
		invites = new InMemoryInviteStore();
		audit = new FakeAuditTrail();
		svc = new ClientDirectoryService(
			new AuthorizationService(
				memberships,
				relationships,
				profiles,
				assignments,
				audit
			),
			new ClientProfileService(profiles),
			new RelationshipService(relationships),
			relationships,
			profiles,
			invites,
			assignments,
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
		origin = ProfileOrigin.AdvisorCreated,
		assignee: string | null = orgId === 'orgA' ? ctx.userId : null
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
		if (assignee) {
			await assignments.assign(orgId, profile.id, assignee, 'admin-1');
		}
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

		describe('por atribuição', () => {
			const admin = { userId: 'admin-1', orgId: 'orgA' };

			beforeEach(async () => {
				await memberships.create({
					userId: admin.userId,
					orgId: 'orgA',
					role: OrgRole.OrgAdmin,
				});
				await memberships.create({
					userId: 'adv-2',
					orgId: 'orgA',
					role: OrgRole.Advisor,
				});
				await addClient('orgA', 'ana', RelationshipStatus.Active);
				await addClient(
					'orgA',
					'bia',
					RelationshipStatus.Active,
					ProfileOrigin.AdvisorCreated,
					'adv-2'
				);
				await addClient(
					'orgA',
					'caio',
					RelationshipStatus.Pending,
					ProfileOrigin.AdvisorCreated,
					null
				);
			});

			const names = async (
				who: { userId: string; orgId: string },
				assignee?: string
			) =>
				(
					await svc.listClients(who, { status: 'OPEN', assignee, limit: 50 })
				).items
					.map((c) => c.name)
					.sort();

			it('ADVISOR vê só os clientes atribuídos a ele', async () => {
				expect(await names(ctx)).toEqual(['ana']);
				expect(await names({ userId: 'adv-2', orgId: 'orgA' })).toEqual([
					'bia',
				]);
			});

			it('ADVISOR que passa assignee recebe 400 ASSIGNEE_FILTER_FORBIDDEN', async () => {
				for (const assignee of ['me', 'none', 'adv-2']) {
					const error = await svc
						.listClients(ctx, { status: 'OPEN', assignee, limit: 50 })
						.catch((e) => e);
					expect(error).toBeInstanceOf(AssigneeFilterForbiddenError);
					expect(error.getStatus()).toBe(400);
					expect(error.getResponse()).toEqual({
						reason: 'ASSIGNEE_FILTER_FORBIDDEN',
					});
				}
			});

			it('ORG_ADMIN sem filtro vê todos; com none, só os sem assessor', async () => {
				expect(await names(admin)).toEqual(['ana', 'bia', 'caio']);
				expect(await names(admin, 'none')).toEqual(['caio']);
			});

			it('ORG_ADMIN filtra por um assessor e por me', async () => {
				expect(await names(admin, ctx.userId)).toEqual(['ana']);
				expect(await names(admin, 'adv-2')).toEqual(['bia']);
				expect(await names(admin, 'me')).toEqual([]);
				await assignments.assign('orgA', 'p-caio', admin.userId, admin.userId);
				expect(await names(admin, 'me')).toEqual(['caio']);
				expect(await names(admin, 'none')).toEqual([]);
			});

			it('desatribuído some da lista do ADVISOR', async () => {
				await assignments.unassign('orgA', 'p-ana', ctx.userId);
				expect(await names(ctx)).toEqual([]);
			});
		});

		it('ADVISOR pagina pelas atribuições pulando o status que não pediu', async () => {
			await addClient('orgA', 'ana', RelationshipStatus.Active);
			await addClient('orgA', 'bia', RelationshipStatus.Revoked);
			await addClient('orgA', 'caio', RelationshipStatus.Revoked);
			await addClient('orgA', 'duda', RelationshipStatus.Pending);
			await addClient('orgA', 'eva', RelationshipStatus.Active);

			const first = await svc.listClients(ctx, { status: 'OPEN', limit: 2 });
			expect(first.items.map((c) => c.name)).toEqual(['ana', 'duda']);
			expect(first.nextCursor).not.toBeNull();
			const second = await svc.listClients(ctx, {
				status: 'OPEN',
				limit: 2,
				cursor: first.nextCursor!,
			});
			expect(second.items.map((c) => c.name)).toEqual(['eva']);
			expect(second.nextCursor).toBeNull();
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

		it('trims the name and stores the trimmed value', async () => {
			const created = await svc.createClient(ctx, { name: '  Maria  ' });
			expect(created.name).toBe('Maria');
		});

		it.each([
			['empty', ''],
			['blank', '   '],
			['121 characters', 'a'.repeat(121)],
			['a control character', 'Ma\u0007ria'],
			['a right-to-left override', 'Ma\u202Eria'],
			['a zero-width space', 'Ma\u200Bria'],
		])('rejects a name that is %s with 400 INVALID_NAME', async (_l, name) => {
			const error = await svc.createClient(ctx, { name }).catch((e) => e);
			expect(error).toMatchObject({ reason: 'INVALID_NAME' });
			expect(error.getStatus()).toBe(400);
			expect(audit.recorded).toEqual([]);
			expect(
				(await svc.listClients(ctx, { status: 'OPEN', limit: 10 })).items
			).toEqual([]);
		});

		it('apaga atribuição, relação e perfil e relança quando a auditoria falha', async () => {
			audit.failWith = new Error('audit down');

			await expect(svc.createClient(ctx, { name: 'Maria' })).rejects.toThrow(
				'audit down'
			);

			expect(profiles.size).toBe(0);
			expect(relationships.size).toBe(0);
			expect(assignments.size).toBe(0);
		});

		it('nasce atribuído ao ADVISOR que criou', async () => {
			const created = await svc.createClient(ctx, { name: 'Maria' });

			expect(await assignments.isAssigned('orgA', created.id, ctx.userId)).toBe(
				true
			);
			await expect(svc.getClient(ctx, created.id)).resolves.toMatchObject({
				id: created.id,
			});
		});

		it('apaga relação e perfil e relança quando a atribuição falha', async () => {
			jest
				.spyOn(assignments, 'assign')
				.mockRejectedValueOnce(new Error('assign down'));

			await expect(svc.createClient(ctx, { name: 'Maria' })).rejects.toThrow(
				'assign down'
			);

			expect(profiles.size).toBe(0);
			expect(relationships.size).toBe(0);
			expect(assignments.size).toBe(0);
			expect(audit.recorded).toEqual([]);
		});

		it('relança o erro original mesmo se o desfazimento falhar', async () => {
			audit.failWith = new Error('audit down');
			jest
				.spyOn(relationships, 'deleteById')
				.mockRejectedValueOnce(new Error('delete down'));

			await expect(svc.createClient(ctx, { name: 'Maria' })).rejects.toThrow(
				'audit down'
			);

			// Os outros passos rodam mesmo com um falhando.
			expect(profiles.size).toBe(0);
			expect(assignments.size).toBe(0);
		});

		it('feito por ORG_ADMIN nasce sem atribuição', async () => {
			await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});

			const created = await svc.createClient(
				{ userId: 'admin-1', orgId: 'orgA' },
				{ name: 'Maria' }
			);

			expect(assignments.size).toBe(0);
			expect(relationships.size).toBe(1);
			expect(created.relationshipStatus).toBe(RelationshipStatus.Active);
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

		it('ADVISOR vê só convites de clientes atribuídos a ele; ORG_ADMIN vê todos', async () => {
			await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});
			for (const [name, assignee] of [
				['ana', ctx.userId],
				['bia', null],
			] as const) {
				const { profile, relationship } = await addClient(
					'orgA',
					name,
					RelationshipStatus.Pending,
					ProfileOrigin.ClientCreated,
					assignee
				);
				await invites.create({
					orgId: 'orgA',
					clientProfileId: profile.id,
					relationshipId: relationship.id,
					email: `${name}@exemplo.com`,
					tokenHash: `h-${name}`,
					status: InviteStatus.Pending,
					expiresAt: new Date(Date.now() + 3600_000),
					resendCount: 0,
					invitedByUserId: 'admin-1',
				});
			}

			const mine = await svc.listPendingInvites(ctx);
			const all = await svc.listPendingInvites({
				userId: 'admin-1',
				orgId: 'orgA',
			});

			expect(mine.map((i) => i.clientName)).toEqual(['ana']);
			expect(all.map((i) => i.clientName).sort()).toEqual(['ana', 'bia']);
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
