import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import { ClientNotAccessibleError } from './access-errors';
import { AccessContext, AuthorizationService } from './authorization.service';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { MembershipStorePort } from './ports/membership.store.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from './ports/portal-account-directory.port';
import type { PortalAccountDirectoryPort } from './ports/portal-account-directory.port';
import type { RelationshipStorePort } from './ports/relationship.store.port';
import { MemberNotFoundError } from './team-errors';

export const CLIENT_ASSIGNED_EVENT = 'advisor.client.assigned';
export const CLIENT_UNASSIGNED_EVENT = 'advisor.client.unassigned';

export interface ClientAssignee {
	userId: string;
	name: string;
}

/**
 * Atribuição de clientes a membros, só pelo ORG_ADMIN. Idempotente: repetir
 * não muda nada nem audita. Auditoria só com ids; falha de auditoria desfaz
 * a mudança.
 */
@Injectable()
export class AssignmentService {
	constructor(
		private readonly authz: AuthorizationService,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_PORTAL_ACCOUNT_DIRECTORY)
		private readonly accounts: PortalAccountDirectoryPort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async assign(
		ctx: AccessContext,
		clientProfileId: string,
		userId: string
	): Promise<void> {
		await this.checkTargets(ctx, clientProfileId, userId);
		// `assign` não diz se criou: quem já está atribuído não muda nem audita.
		const existed = await this.assignments.isAssigned(
			ctx.orgId,
			clientProfileId,
			userId
		);
		if (existed) return;

		await this.assignments.assign(
			ctx.orgId,
			clientProfileId,
			userId,
			ctx.userId
		);
		try {
			await this.record(CLIENT_ASSIGNED_EVENT, ctx, clientProfileId, userId);
		} catch (error) {
			await this.assignments
				.unassign(ctx.orgId, clientProfileId, userId)
				.catch(() => undefined);
			throw error;
		}
	}

	async unassign(
		ctx: AccessContext,
		clientProfileId: string,
		userId: string
	): Promise<void> {
		await this.checkTargets(ctx, clientProfileId, userId);
		const removed = await this.assignments.unassign(
			ctx.orgId,
			clientProfileId,
			userId
		);
		if (!removed) return;
		try {
			await this.record(CLIENT_UNASSIGNED_EVENT, ctx, clientProfileId, userId);
		} catch (error) {
			await this.assignments
				.assign(ctx.orgId, clientProfileId, userId, ctx.userId)
				.catch(() => undefined);
			throw error;
		}
	}

	async listAssignees(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<ClientAssignee[]> {
		await this.authz.ensureOrgAdmin(ctx);
		await this.ensureClientInOrg(ctx, clientProfileId);
		const rows = await this.assignments.listByClient(
			ctx.orgId,
			clientProfileId
		);
		const profiles = await this.accounts.findProfiles(
			rows.map((row) => row.userId)
		);
		return rows.map((row) => ({
			userId: row.userId,
			name: profiles.get(row.userId)?.name ?? '',
		}));
	}

	/** ORG_ADMIN, cliente da org (pela relação) e destino membro da org. */
	private async checkTargets(
		ctx: AccessContext,
		clientProfileId: string,
		userId: string
	): Promise<void> {
		await this.authz.ensureOrgAdmin(ctx);
		await this.ensureClientInOrg(ctx, clientProfileId);
		const member = await this.memberships.findByUserAndOrg(userId, ctx.orgId);
		if (!member) throw new MemberNotFoundError();
	}

	private async ensureClientInOrg(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<void> {
		const relationship = await this.relationships.findByOrgAndClient(
			ctx.orgId,
			clientProfileId
		);
		if (!relationship) throw new ClientNotAccessibleError();
	}

	private async record(
		type: string,
		ctx: AccessContext,
		clientProfileId: string,
		userId: string
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject: clientProfileId,
			actorRef: actorRefOf(ctx.userId),
			occurredAt: new Date(),
			payload: { orgId: ctx.orgId, userId },
		});
	}
}
