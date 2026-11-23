import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { AdvisorType, OrgRole, RelationshipStatus } from '../domain/enums';
import { ClientNotAccessibleError, RoleRequiredError } from './access-errors';
import {
	AssignmentService,
	CLIENT_ASSIGNED_EVENT,
	CLIENT_UNASSIGNED_EVENT,
} from './assignment.service';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryRelationshipStore,
	RecordingSnapshotTrigger,
} from './in-memory-stores.fixture';
import { MemberNotFoundError } from './team-errors';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) {
			const error = this.failWith;
			// Só o evento de atribuição falha; o acesso do ator não passa por aqui.
			throw error;
		}
		this.recorded.push(event);
	}
}

const ADMIN = 'admin-1';
const ADVISOR = 'adv-1';
const OUTSIDER = 'outsider-1';
const CLIENT = 'client-1';
const FOREIGN_CLIENT = 'client-other-org';

describe('AssignmentService', () => {
	let memberships: InMemoryMembershipStore;
	let assignments: InMemoryAssignmentStore;
	let relationships: InMemoryRelationshipStore;
	let directory: InMemoryPortalAccountDirectory;
	let audit: FakeAuditTrail;
	let service: AssignmentService;
	let trigger: RecordingSnapshotTrigger;
	let orgId: string;
	let adminCtx: { userId: string; orgId: string };

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
		directory = new InMemoryPortalAccountDirectory();
		audit = new FakeAuditTrail();
		const orgs = new InMemoryOrganizationStore();
		const org = await orgs.create({
			name: 'Escritório A',
			advisorType: AdvisorType.Assessor,
			ownerUserId: ADMIN,
		});
		orgId = org.id;
		adminCtx = { userId: ADMIN, orgId };
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		await relationships.save({
			id: 'r1',
			orgId,
			clientProfileId: CLIENT,
			status: RelationshipStatus.Active,
		});
		directory.set(ADVISOR, 'fulano@escritorio.com', 'Fulano de Tal');
		service = new AssignmentService(
			new AuthorizationService(
				memberships,
				relationships,
				new InMemoryClientProfileStore(),
				assignments,
				audit
			),
			assignments,
			memberships,
			relationships,
			directory,
			audit,
			(trigger = new RecordingSnapshotTrigger())
		);
	});

	const events = () => audit.recorded.map((e) => e.type);

	describe('assign', () => {
		it('atribui o cliente ao membro e audita só com ids', async () => {
			await service.assign(adminCtx, CLIENT, ADVISOR);

			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(true);
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0]).toMatchObject({
				type: CLIENT_ASSIGNED_EVENT,
				subject: CLIENT,
				payload: { orgId, userId: ADVISOR },
			});
		});

		it('pede a recomputação só quando atribui ou desatribui de fato', async () => {
			await service.assign(adminCtx, CLIENT, ADVISOR);
			await service.assign(adminCtx, CLIENT, ADVISOR);
			expect(trigger.requests).toEqual([`${orgId}:${CLIENT}`]);

			await service.unassign(adminCtx, CLIENT, ADVISOR);
			await service.unassign(adminCtx, CLIENT, ADVISOR);
			expect(trigger.requests).toEqual([
				`${orgId}:${CLIENT}`,
				`${orgId}:${CLIENT}`,
			]);
		});

		it('auditoria que falha desfaz e não pede recomputação', async () => {
			audit.failWith = new Error('audit down');
			await expect(service.assign(adminCtx, CLIENT, ADVISOR)).rejects.toThrow();
			expect(trigger.requests).toEqual([]);
		});

		it('é idempotente: repetir não muda nada nem audita', async () => {
			await service.assign(adminCtx, CLIENT, ADVISOR);
			const first = await assignments.listByClient(orgId, CLIENT);

			await service.assign(adminCtx, CLIENT, ADVISOR);

			expect(await assignments.listByClient(orgId, CLIENT)).toEqual(first);
			expect(events()).toEqual([CLIENT_ASSIGNED_EVENT]);
		});

		it('linha criada por outra requisição: não audita nem desfaz a dela', async () => {
			await assignments.assign(orgId, CLIENT, ADVISOR, ADMIN);
			audit.failWith = new Error('audit down');

			await expect(
				service.assign(adminCtx, CLIENT, ADVISOR)
			).resolves.toBeUndefined();

			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(true);
		});

		it('destino que não é membro dá 404 e não grava', async () => {
			await expect(
				service.assign(adminCtx, CLIENT, OUTSIDER)
			).rejects.toBeInstanceOf(MemberNotFoundError);
			expect(assignments.size).toBe(0);
			expect(audit.recorded).toHaveLength(0);
		});

		it('cliente de outra organização é recusado pela relação da org', async () => {
			await expect(
				service.assign(adminCtx, FOREIGN_CLIENT, ADVISOR)
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(assignments.size).toBe(0);
			expect(audit.recorded).toHaveLength(0);
		});

		it('ADVISOR não atribui (403 ROLE_REQUIRED)', async () => {
			await expect(
				service.assign({ userId: ADVISOR, orgId }, CLIENT, ADVISOR)
			).rejects.toBeInstanceOf(RoleRequiredError);
			expect(assignments.size).toBe(0);
		});

		it('falha de auditoria desfaz a atribuição', async () => {
			audit.failWith = new Error('audit down');

			await expect(service.assign(adminCtx, CLIENT, ADVISOR)).rejects.toThrow(
				'audit down'
			);

			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(false);
		});
	});

	describe('unassign', () => {
		beforeEach(async () => {
			await assignments.assign(orgId, CLIENT, ADVISOR, ADMIN);
		});

		it('remove a atribuição e audita', async () => {
			await service.unassign(adminCtx, CLIENT, ADVISOR);

			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(false);
			expect(audit.recorded[0]).toMatchObject({
				type: CLIENT_UNASSIGNED_EVENT,
				subject: CLIENT,
				payload: { orgId, userId: ADVISOR },
			});
		});

		it('é idempotente: repetir não audita de novo', async () => {
			await service.unassign(adminCtx, CLIENT, ADVISOR);
			await service.unassign(adminCtx, CLIENT, ADVISOR);

			expect(events()).toEqual([CLIENT_UNASSIGNED_EVENT]);
		});

		it('destino que não é membro dá 404', async () => {
			await expect(
				service.unassign(adminCtx, CLIENT, OUTSIDER)
			).rejects.toBeInstanceOf(MemberNotFoundError);
		});

		it('cliente de outra organização é recusado', async () => {
			await expect(
				service.unassign(adminCtx, FOREIGN_CLIENT, ADVISOR)
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
		});

		it('ADVISOR não desatribui (403 ROLE_REQUIRED)', async () => {
			await expect(
				service.unassign({ userId: ADVISOR, orgId }, CLIENT, ADVISOR)
			).rejects.toBeInstanceOf(RoleRequiredError);
			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(true);
		});

		it('falha de auditoria devolve a atribuição', async () => {
			audit.failWith = new Error('audit down');

			await expect(service.unassign(adminCtx, CLIENT, ADVISOR)).rejects.toThrow(
				'audit down'
			);

			expect(await assignments.isAssigned(orgId, CLIENT, ADVISOR)).toBe(true);
		});
	});

	describe('listAssignees', () => {
		it('lista userId e nome, sem e-mail', async () => {
			await assignments.assign(orgId, CLIENT, ADVISOR, ADMIN);
			await assignments.assign(orgId, CLIENT, ADMIN, ADMIN);

			const assignees = await service.listAssignees(adminCtx, CLIENT);

			expect(assignees).toEqual([
				{ userId: ADVISOR, name: 'Fulano de Tal' },
				{ userId: ADMIN, name: '' },
			]);
			expect(JSON.stringify(assignees)).not.toContain('@');
		});

		it('ADVISOR não lista (403 ROLE_REQUIRED)', async () => {
			await expect(
				service.listAssignees({ userId: ADVISOR, orgId }, CLIENT)
			).rejects.toBeInstanceOf(RoleRequiredError);
		});

		it('cliente de outra organização é recusado', async () => {
			await expect(
				service.listAssignees(adminCtx, FOREIGN_CLIENT)
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
		});
	});
});
