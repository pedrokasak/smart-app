import {
	ConflictException,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AdvisorType,
	MemberInviteStatus,
	OrgRole,
	RelationshipStatus,
} from '../domain/enums';
import { RoleRequiredError } from './access-errors';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryPortalGrantStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { MembershipService } from './membership.service';
import { OrganizationService } from './organization.service';
import { MemberNotFoundError } from './team-errors';
import {
	MEMBER_LEFT_EVENT,
	MEMBER_PROMOTED_EVENT,
	MEMBER_REMOVED_EVENT,
	TeamService,
} from './team.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}
}

/** 409 e o `reason` com que a promessa foi rejeitada. */
async function conflictReason(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(ConflictException);
		return (error as ConflictException).getResponse();
	}
	return undefined;
}

const OWNER = 'owner-1';
const ADMIN = 'admin-2';
const ADVISOR = 'adv-1';
const OTHER_ADVISOR = 'adv-2';
const OUTSIDER = 'outsider-1';

describe('TeamService', () => {
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	let relationships: InMemoryRelationshipStore;
	let directory: InMemoryPortalAccountDirectory;
	let memberInvites: InMemoryMemberInviteStore;
	let portalGrants: InMemoryPortalGrantStore;
	let audit: FakeAuditTrail;
	let service: TeamService;
	let orgId: string;
	let ownerCtx: { userId: string; orgId: string };

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		directory = new InMemoryPortalAccountDirectory();
		memberInvites = new InMemoryMemberInviteStore();
		portalGrants = new InMemoryPortalGrantStore();
		audit = new FakeAuditTrail();
		const orgs = new InMemoryOrganizationStore();
		const org = await orgs.create({
			name: 'Escritório A',
			advisorType: AdvisorType.Assessor,
			ownerUserId: OWNER,
		});
		orgId = org.id;
		ownerCtx = { userId: OWNER, orgId };
		await memberships.create({ userId: OWNER, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		await memberships.create({
			userId: OTHER_ADVISOR,
			orgId,
			role: OrgRole.Advisor,
		});
		directory.set(OWNER, 'dono@escritorio.com', 'Dona Dona');
		directory.set(ADVISOR, 'fulano@escritorio.com', 'Fulano de Tal');
		service = new TeamService(
			new AuthorizationService(
				memberships,
				relationships,
				new InMemoryClientProfileStore(),
				assignments,
				audit
			),
			new OrganizationService(
				orgs,
				new MembershipService(memberships),
				undefined as never,
				audit
			),
			memberships,
			assignments,
			directory,
			audit,
			memberInvites,
			portalGrants
		);
	});

	const events = () => audit.recorded.map((e) => e.type);
	const advisorCtx = { get: () => ({ userId: ADVISOR, orgId }) };
	const assign = (clientId: string, userId = ADVISOR) =>
		assignments.assign(orgId, clientId, userId, OWNER);
	const roleOf = async (userId: string) =>
		(await memberships.findByUserAndOrg(userId, orgId))?.role;

	describe('listMembers', () => {
		it('lista a equipe com nome, e-mail mascarado, papel e dono', async () => {
			const members = await service.listMembers(advisorCtx.get());

			expect(members.map((m) => m.userId)).toEqual([
				OWNER,
				ADMIN,
				ADVISOR,
				OTHER_ADVISOR,
			]);
			const owner = members[0];
			expect(owner).toMatchObject({
				name: 'Dona Dona',
				role: OrgRole.OrgAdmin,
				isOwner: true,
			});
			expect(owner.joinedAt).toBeInstanceOf(Date);
			expect(members.filter((m) => m.isOwner)).toHaveLength(1);
		});

		it('nunca devolve o e-mail em claro', async () => {
			const members = await service.listMembers(ownerCtx);

			const serialized = JSON.stringify(members);
			expect(serialized).not.toContain('fulano@escritorio.com');
			expect(serialized).not.toContain('dono@escritorio.com');
			expect(members.find((m) => m.userId === ADVISOR)?.emailMasked).toBe(
				'fu***@es***.com'
			);
		});

		it('mostra nome e e-mail vazios quando a conta não existe mais', async () => {
			const members = await service.listMembers(ownerCtx);

			expect(members.find((m) => m.userId === ADMIN)).toMatchObject({
				name: '',
				emailMasked: '',
			});
		});

		it('recusa quem não é membro da organização', async () => {
			await expect(
				service.listMembers({ userId: OUTSIDER, orgId })
			).rejects.toBeInstanceOf(ForbiddenException);
		});
	});

	describe('removeMember', () => {
		it('o dono não é removido e nada é apagado', async () => {
			expect(
				await conflictReason(
					service.removeMember({ userId: ADMIN, orgId }, OWNER)
				)
			).toEqual({ reason: 'OWNER_CANNOT_BE_REMOVED' });
			expect(await roleOf(OWNER)).toBe(OrgRole.OrgAdmin);
			expect(audit.recorded).toHaveLength(0);
		});

		it('ADVISOR não remove ninguém (403 ROLE_REQUIRED)', async () => {
			await expect(
				service.removeMember(advisorCtx.get(), OTHER_ADVISOR)
			).rejects.toBeInstanceOf(RoleRequiredError);
			expect(await roleOf(OTHER_ADVISOR)).toBe(OrgRole.Advisor);
			expect(audit.recorded).toHaveLength(0);
		});

		it('apaga o vínculo e as atribuições dele, e audita só com ids', async () => {
			await assign('c1');
			await assign('c2');
			await assign('c1', OTHER_ADVISOR);

			await service.removeMember(ownerCtx, ADVISOR);

			expect(await roleOf(ADVISOR)).toBeUndefined();
			expect(
				(await assignments.listByClient(orgId, 'c1')).map((a) => a.userId)
			).toEqual([OTHER_ADVISOR]);
			expect(await assignments.listByClient(orgId, 'c2')).toEqual([]);
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0]).toMatchObject({
				type: MEMBER_REMOVED_EVENT,
				subject: ADVISOR,
				payload: { orgId },
			});
			expect(JSON.stringify(audit.recorded)).not.toContain('@');
		});

		it('os clientes continuam visíveis para o ORG_ADMIN', async () => {
			await relationships.save({
				id: 'r1',
				orgId,
				clientProfileId: 'c1',
				status: RelationshipStatus.Active,
			});
			await assign('c1');

			await service.removeMember(ownerCtx, ADVISOR);

			expect(
				await relationships.findByOrgAndClient(orgId, 'c1')
			).not.toBeNull();
		});

		it('quem não é membro dá 404 e não audita', async () => {
			await expect(
				service.removeMember(ownerCtx, OUTSIDER)
			).rejects.toBeInstanceOf(MemberNotFoundError);
			await expect(
				service.removeMember(ownerCtx, OUTSIDER)
			).rejects.toBeInstanceOf(NotFoundException);
			expect(audit.recorded).toHaveLength(0);
		});

		it('falha de auditoria desfaz: vínculo (papel e data) e atribuições voltam', async () => {
			await memberships.setRole(ADVISOR, orgId, OrgRole.Advisor);
			await assign('c1');
			await assign('c2');
			const before = await memberships.findByUserAndOrg(ADVISOR, orgId);
			audit.failWith = new Error('audit down');

			await expect(service.removeMember(ownerCtx, ADVISOR)).rejects.toThrow(
				'audit down'
			);

			const after = await memberships.findByUserAndOrg(ADVISOR, orgId);
			expect(after).toMatchObject({
				role: before?.role,
				createdAt: before?.createdAt,
			});
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(true);
			expect(await assignments.isAssigned(orgId, 'c2', ADVISOR)).toBe(true);
			expect(audit.recorded).toHaveLength(0);
		});

		it('falha ao apagar as atribuições também restaura o vínculo', async () => {
			await assign('c1');
			jest
				.spyOn(assignments, 'deleteByUser')
				.mockRejectedValueOnce(new Error('db down'));

			await expect(service.removeMember(ownerCtx, ADVISOR)).rejects.toThrow(
				'db down'
			);

			expect(await roleOf(ADVISOR)).toBe(OrgRole.Advisor);
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(true);
		});

		it('a ordem da equipe não muda depois de um desfazer', async () => {
			audit.failWith = new Error('audit down');
			await expect(service.removeMember(ownerCtx, ADVISOR)).rejects.toThrow(
				'audit down'
			);
			audit.failWith = undefined;

			const members = await service.listMembers(ownerCtx);

			expect(members.map((m) => m.userId)).toEqual([
				OWNER,
				ADMIN,
				ADVISOR,
				OTHER_ADVISOR,
			]);
		});
	});

	describe('promote', () => {
		it('promove um ADVISOR e audita', async () => {
			const result = await service.promote(ownerCtx, ADVISOR);

			expect(result).toEqual({ userId: ADVISOR, role: OrgRole.OrgAdmin });
			expect(await roleOf(ADVISOR)).toBe(OrgRole.OrgAdmin);
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0]).toMatchObject({
				type: MEMBER_PROMOTED_EVENT,
				subject: ADVISOR,
				payload: { orgId },
			});
		});

		it('promover duas vezes audita uma só', async () => {
			await service.promote(ownerCtx, ADVISOR);
			const again = await service.promote(ownerCtx, ADVISOR);

			expect(again.role).toBe(OrgRole.OrgAdmin);
			expect(events()).toEqual([MEMBER_PROMOTED_EVENT]);
		});

		it('ADVISOR não promove (403 ROLE_REQUIRED)', async () => {
			await expect(
				service.promote(advisorCtx.get(), OTHER_ADVISOR)
			).rejects.toBeInstanceOf(RoleRequiredError);
			expect(await roleOf(OTHER_ADVISOR)).toBe(OrgRole.Advisor);
			expect(audit.recorded).toHaveLength(0);
		});

		it('quem não é membro dá 404', async () => {
			await expect(service.promote(ownerCtx, OUTSIDER)).rejects.toBeInstanceOf(
				MemberNotFoundError
			);
			expect(audit.recorded).toHaveLength(0);
		});

		it('falha de auditoria devolve o papel ADVISOR', async () => {
			audit.failWith = new Error('audit down');

			await expect(service.promote(ownerCtx, ADVISOR)).rejects.toThrow(
				'audit down'
			);

			expect(await roleOf(ADVISOR)).toBe(OrgRole.Advisor);
		});
	});

	describe('leave', () => {
		it('o dono não sai e nada é apagado', async () => {
			expect(await conflictReason(service.leave(ownerCtx))).toEqual({
				reason: 'OWNER_CANNOT_LEAVE',
			});
			expect(await roleOf(OWNER)).toBe(OrgRole.OrgAdmin);
			expect(audit.recorded).toHaveLength(0);
		});

		it('o ADVISOR sai: vínculo e atribuições somem, evento left', async () => {
			await assign('c1');

			await service.leave(advisorCtx.get());

			expect(await roleOf(ADVISOR)).toBeUndefined();
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(false);
			expect(audit.recorded[0]).toMatchObject({
				type: MEMBER_LEFT_EVENT,
				subject: ADVISOR,
				payload: { orgId },
			});
		});

		it('um ORG_ADMIN que não é o dono pode sair', async () => {
			await service.leave({ userId: ADMIN, orgId });

			expect(await roleOf(ADMIN)).toBeUndefined();
		});

		it('quem não é membro não sai (403) e não audita', async () => {
			await expect(
				service.leave({ userId: OUTSIDER, orgId })
			).rejects.toBeInstanceOf(ForbiddenException);
			expect(audit.recorded).toHaveLength(0);
		});

		it('falha de auditoria desfaz a saída', async () => {
			await assign('c1');
			audit.failWith = new Error('audit down');

			await expect(service.leave(advisorCtx.get())).rejects.toThrow(
				'audit down'
			);

			expect(await roleOf(ADVISOR)).toBe(OrgRole.Advisor);
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(true);
		});
	});
	describe('eraseUser (LGPD)', () => {
		const EMAIL = 'fulano@escritorio.com';
		const pendingInvite = (orgId: string, email: string) =>
			memberInvites.create({
				orgId,
				email,
				role: OrgRole.Advisor,
				tokenHash: `hash-${orgId}-${email}`,
				status: MemberInviteStatus.Pending,
				expiresAt: new Date(Date.now() + 86_400_000),
				resendCount: 0,
				invitedByUserId: OWNER,
			});

		it('apaga vínculos, atribuições e convite pendente do membro; os clientes ficam', async () => {
			await assign('c1');
			await assign('c2');
			await assign('c1', OTHER_ADVISOR);
			await pendingInvite(orgId, EMAIL);

			const result = await service.eraseUser(ADVISOR, 'Fulano@Escritorio.com');

			expect(result).toEqual({
				memberships: 1,
				assignments: 2,
				memberInvites: 1,
				portalGrants: 0,
			});
			expect(await memberships.findByUserAndOrg(ADVISOR, orgId)).toBeNull();
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(false);
			expect(await assignments.isAssigned(orgId, 'c2', ADVISOR)).toBe(false);
			expect(memberInvites.size).toBe(0);
			// quem ficou na organização e as atribuições dele seguem intactos
			expect(await roleOf(OTHER_ADVISOR)).toBe(OrgRole.Advisor);
			expect(await assignments.isAssigned(orgId, 'c1', OTHER_ADVISOR)).toBe(
				true
			);
		});

		it('apaga o vínculo em toda organização e só o convite pendente do e-mail', async () => {
			const other = await memberships.create({
				userId: ADVISOR,
				orgId: 'org-2',
				role: OrgRole.Advisor,
			});
			await pendingInvite(orgId, EMAIL);
			await pendingInvite('org-2', EMAIL);
			await pendingInvite(orgId, 'outra@escritorio.com');

			const result = await service.eraseUser(ADVISOR, EMAIL);

			expect(result.memberships).toBe(2);
			expect(result.memberInvites).toBe(2);
			expect(
				await memberships.findByUserAndOrg(ADVISOR, other.orgId)
			).toBeNull();
			expect(memberInvites.size).toBe(1);
		});

		it('apaga a liberação do portal do usuário (ativa e revogada), não a de outro', async () => {
			await portalGrants.grant(OWNER, ADMIN, new Date());
			await portalGrants.revoke(OWNER, new Date());
			await portalGrants.grant(OWNER, ADMIN, new Date());
			await portalGrants.grant(ADVISOR, ADMIN, new Date());

			const result = await service.eraseUser(OWNER, undefined);

			expect(result.portalGrants).toBe(2);
			expect(await portalGrants.findActive(OWNER)).toBeNull();
			expect(await portalGrants.findActive(ADVISOR)).not.toBeNull();
		});

		it('sem e-mail, apaga vínculos e atribuições e mantém os convites', async () => {
			await assign('c1');
			await pendingInvite(orgId, EMAIL);

			for (const email of [undefined, '', '   ', 'sem-arroba']) {
				const result = await service.eraseUser(ADVISOR, email);
				expect(result.memberInvites).toBe(0);
			}

			expect(await memberships.findByUserAndOrg(ADVISOR, orgId)).toBeNull();
			expect(await assignments.isAssigned(orgId, 'c1', ADVISOR)).toBe(false);
			expect(memberInvites.size).toBe(1);
		});

		it('é idempotente e não audita (o evento carregaria o id apagado)', async () => {
			await service.eraseUser(ADVISOR, EMAIL);
			const again = await service.eraseUser(ADVISOR, EMAIL);

			expect(again).toEqual({
				memberships: 0,
				assignments: 0,
				memberInvites: 0,
				portalGrants: 0,
			});
			expect(audit.recorded).toHaveLength(0);
		});

		it('falha de um store sobe, para a exclusão ser repetida', async () => {
			jest
				.spyOn(memberships, 'deleteAllForUser')
				.mockRejectedValueOnce(new Error('store down'));

			await expect(service.eraseUser(ADVISOR, EMAIL)).rejects.toThrow(
				'store down'
			);
			await expect(service.eraseUser(ADVISOR, EMAIL)).resolves.toMatchObject({
				memberships: 1,
			});
		});
	});
});
