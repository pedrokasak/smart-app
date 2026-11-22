import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { OrgRole, ProfileOrigin } from '../domain/enums';
import {
	ClientActionForbiddenError,
	ClientNotAccessibleError,
} from './access-errors';
import {
	AuthorizationService,
	RoleRequiredError,
} from './authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
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

describe('AuthorizationService', () => {
	const userId = 'user-raw-id-123';
	let memberships: InMemoryMembershipStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let assignments: InMemoryAssignmentStore;
	let rel: RelationshipService;
	let audit: FakeAuditTrail;
	let authz: AuthorizationService;

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		relationships = new InMemoryRelationshipStore();
		profiles = new InMemoryClientProfileStore();
		assignments = new InMemoryAssignmentStore();
		rel = new RelationshipService(relationships);
		audit = new FakeAuditTrail();
		authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
	});

	const seed = (
		id: string,
		orgId: string,
		origin = ProfileOrigin.AdvisorCreated
	) => profiles.seed({ id, orgId, name: id, origin });

	const assignToUser = (clientProfileId: string, orgId = 'orgA') =>
		assignments.assign(orgId, clientProfileId, userId, 'admin-1');

	it('denies a client of another org and audits nothing', async () => {
		seed('clientB', 'orgB');
		await rel.create('orgB', 'clientB');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientB',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('allows a valid access and records one pseudonymous event', async () => {
		seed('clientA', 'orgA');
		await rel.create('orgA', 'clientA');
		await assignToUser('clientA');
		await authz.ensureCanAccessClient(
			{ userId, orgId: 'orgA' },
			'clientA',
			'VIEW_PORTFOLIO'
		);
		expect(audit.recorded).toHaveLength(1);
		const event = audit.recorded[0];
		expect(event).toMatchObject({
			type: 'advisor.client.accessed',
			version: 1,
			subject: 'clientA',
			actorRef: actorRefOf(userId),
		});
		expect(Object.keys(event).sort()).toEqual(
			[
				'eventId',
				'type',
				'version',
				'subject',
				'actorRef',
				'occurredAt',
				'payload',
			].sort()
		);
		expect(event.payload).toEqual({ action: 'VIEW_PORTFOLIO', orgId: 'orgA' });
		expect(event.eventId).toEqual(expect.any(String));
		expect(event.occurredAt).toBeInstanceOf(Date);
		expect(JSON.stringify(event)).not.toContain(userId);
	});

	it('denies after the relationship is revoked and audits nothing', async () => {
		seed('clientA', 'orgA');
		const r = await rel.create('orgA', 'clientA');
		await rel.revoke(r.id);
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies a user without membership in the org', async () => {
		seed('clientA', 'orgA');
		await rel.create('orgA', 'clientA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId: 'stranger', orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies when there is no relationship with the client', async () => {
		// Perfil ADVISOR_CREATED da mesma org: só falta o vínculo.
		seed('clientA', 'orgA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('never falls back to another org membership', async () => {
		// user is a member of orgA only; orgB has an ACTIVE relationship
		seed('clientB', 'orgB');
		await rel.create('orgB', 'clientB');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgB' },
				'clientB',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies ctx.orgId of an org the user is not in, even if the client is active in the user org', async () => {
		// member of orgA only, ACTIVE orgA<->clientA; a fallback would allow this
		seed('clientA', 'orgA');
		await rel.create('orgA', 'clientA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgB' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('fails closed when the audit trail cannot record', async () => {
		seed('clientA', 'orgA');
		await rel.create('orgA', 'clientA');
		await assignToUser('clientA');
		audit.failWith = new Error('audit store down');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow('audit store down');
	});

	it('is a ForbiddenException with reason CLIENT_NOT_ACCESSIBLE', async () => {
		const error = await authz
			.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'unknown-client',
				'VIEW_PORTFOLIO'
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ClientNotAccessibleError);
		expect(error).toBeInstanceOf(ForbiddenException);
		expect((error as ClientNotAccessibleError).reason).toBe(
			'CLIENT_NOT_ACCESSIBLE'
		);
	});

	it('denies a profile of another org even with an active relationship', async () => {
		seed('clientA', 'orgB');
		await rel.create('orgA', 'clientA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies a client without a profile', async () => {
		await rel.create('orgA', 'ghost');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'ghost',
				'VIEW_PORTFOLIO'
			)
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
		expect(audit.recorded).toHaveLength(0);
	});

	it('throws ClientActionForbiddenError for a write on a CLIENT_CREATED profile, without auditing', async () => {
		seed('clientA', 'orgA', ProfileOrigin.ClientCreated);
		await rel.create('orgA', 'clientA');
		await assignToUser('clientA');
		const error = await authz
			.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'EDIT_POSITION'
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ClientActionForbiddenError);
		expect(error).toBeInstanceOf(ForbiddenException);
		expect((error as ClientActionForbiddenError).reason).toBe(
			'ACTION_FORBIDDEN'
		);
		expect(audit.recorded).toHaveLength(0);
	});

	it('allows reading a CLIENT_CREATED profile and audits it', async () => {
		seed('clientA', 'orgA', ProfileOrigin.ClientCreated);
		await rel.create('orgA', 'clientA');
		await assignToUser('clientA');
		await authz.ensureCanAccessClient(
			{ userId, orgId: 'orgA' },
			'clientA',
			'VIEW_PORTFOLIO'
		);
		expect(audit.recorded).toHaveLength(1);
	});

	describe('ensureOrgMember', () => {
		it('returns the membership of a member of the org', async () => {
			const membership = await authz.ensureOrgMember({
				userId,
				orgId: 'orgA',
			});
			expect(membership).toMatchObject({
				userId,
				orgId: 'orgA',
				role: OrgRole.Advisor,
			});
		});

		it('accepts an ORG_ADMIN', async () => {
			await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});
			await expect(
				authz.ensureOrgMember({ userId: 'admin-1', orgId: 'orgA' })
			).resolves.toMatchObject({ role: OrgRole.OrgAdmin });
		});

		it('denies a member of another org only, without auditing', async () => {
			await expect(
				authz.ensureOrgMember({ userId, orgId: 'orgB' })
			).rejects.toThrow(ForbiddenException);
			await expect(
				authz.ensureOrgMember({ userId: 'stranger', orgId: 'orgA' })
			).rejects.toThrow(ForbiddenException);
			expect(audit.recorded).toHaveLength(0);
		});

		it('does not call the audit trail on success', async () => {
			await authz.ensureOrgMember({ userId, orgId: 'orgA' });
			expect(audit.recorded).toHaveLength(0);
		});
	});

	describe('atribuição', () => {
		const ctx = { userId, orgId: 'orgA' };

		beforeEach(async () => {
			await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});
			seed('clientA', 'orgA');
			await rel.create('orgA', 'clientA');
		});

		it('nega ao ADVISOR um cliente da org sem atribuição, com o mesmo erro de outra org e sem auditar', async () => {
			const error = await authz
				.ensureCanAccessClient(ctx, 'clientA', 'VIEW_PORTFOLIO')
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(ClientNotAccessibleError);
			expect((error as ClientNotAccessibleError).reason).toBe(
				'CLIENT_NOT_ACCESSIBLE'
			);
			expect(audit.recorded).toHaveLength(0);
		});

		it('não aceita atribuição de outra org nem de outro assessor', async () => {
			await assignments.assign('orgB', 'clientA', userId, 'admin-1');
			await assignments.assign('orgA', 'clientA', 'other-advisor', 'admin-1');

			await expect(
				authz.ensureCanAccessClient(ctx, 'clientA', 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(audit.recorded).toHaveLength(0);
		});

		it('libera o ADVISOR atribuído e nega de novo depois de desatribuído', async () => {
			await assignToUser('clientA');
			await authz.ensureCanAccessClient(ctx, 'clientA', 'VIEW_PORTFOLIO');
			expect(audit.recorded).toHaveLength(1);

			await assignments.unassign('orgA', 'clientA', userId);

			await expect(
				authz.ensureCanAccessClient(ctx, 'clientA', 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(audit.recorded).toHaveLength(1);
		});

		it('libera o ORG_ADMIN sem atribuição e nem consulta a atribuição', async () => {
			const isAssigned = jest.spyOn(assignments, 'isAssigned');

			await authz.ensureCanAccessClient(
				{ userId: 'admin-1', orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			);

			expect(audit.recorded).toHaveLength(1);
			expect(isAssigned).not.toHaveBeenCalled();
		});

		it('não consulta a atribuição de quem não é membro', async () => {
			const isAssigned = jest.spyOn(assignments, 'isAssigned');

			await expect(
				authz.ensureCanAccessClient(
					{ userId: 'stranger', orgId: 'orgA' },
					'clientA',
					'VIEW_PORTFOLIO'
				)
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(isAssigned).not.toHaveBeenCalled();
		});
	});

	describe('ensureOrgAdmin', () => {
		it('devolve a membership do ORG_ADMIN', async () => {
			await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});
			await expect(
				authz.ensureOrgAdmin({ userId: 'admin-1', orgId: 'orgA' })
			).resolves.toMatchObject({ userId: 'admin-1', role: OrgRole.OrgAdmin });
		});

		it('recusa o ADVISOR com 403 ROLE_REQUIRED', async () => {
			const error = await authz
				.ensureOrgAdmin({ userId, orgId: 'orgA' })
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(RoleRequiredError);
			expect(error).toBeInstanceOf(ForbiddenException);
			expect((error as RoleRequiredError).getStatus()).toBe(403);
			expect((error as RoleRequiredError).getResponse()).toEqual({
				reason: 'ROLE_REQUIRED',
			});
		});

		it('recusa quem não é membro, sem ROLE_REQUIRED', async () => {
			const error = await authz
				.ensureOrgAdmin({ userId: 'stranger', orgId: 'orgA' })
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ForbiddenException);
			expect(error).not.toBeInstanceOf(RoleRequiredError);
		});
	});

	describe('isClientInScope', () => {
		it('ORG_ADMIN alcança qualquer cliente; ADVISOR só os atribuídos', async () => {
			const admin = await memberships.create({
				userId: 'admin-1',
				orgId: 'orgA',
				role: OrgRole.OrgAdmin,
			});
			const advisor = await authz.ensureOrgMember({ userId, orgId: 'orgA' });
			await assignToUser('clientA');

			await expect(authz.isClientInScope(admin, 'clientZ')).resolves.toBe(true);
			await expect(authz.isClientInScope(advisor, 'clientA')).resolves.toBe(
				true
			);
			await expect(authz.isClientInScope(advisor, 'clientZ')).resolves.toBe(
				false
			);
		});
	});
});
