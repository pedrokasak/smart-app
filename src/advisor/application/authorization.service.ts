import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { canAccessClient, isAllowedRole } from '../domain/access-policy';
import { Membership } from '../domain/entities';
import { ClientAction, OrgRole } from '../domain/enums';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import {
	ClientActionForbiddenError,
	ClientNotAccessibleError,
	RoleRequiredError,
} from './access-errors';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { MembershipStorePort } from './ports/membership.store.port';
import type { RelationshipStorePort } from './ports/relationship.store.port';

export interface AccessContext {
	userId: string;
	orgId: string;
}

export const CLIENT_ACCESSED_EVENT = 'advisor.client.accessed';

@Injectable()
export class AuthorizationService {
	constructor(
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	/**
	 * Resolves the membership strictly in ctx.orgId (no fallback to another
	 * org), the relationship for (orgId, client) and the client profile (which
	 * must belong to ctx.orgId), then applies the access policy. The assignment
	 * is read only for an ADVISOR membership, alongside the relationship and
	 * profile reads. Denial (an unassigned client included) throws without
	 * auditing; success is audited and, if the audit cannot be written, the
	 * access is refused too (fail closed).
	 */
	async ensureCanAccessClient(
		ctx: AccessContext,
		clientProfileId: string,
		action: ClientAction
	): Promise<void> {
		const membershipRead = this.memberships.findByUserAndOrg(
			ctx.userId,
			ctx.orgId
		);
		const assignedRead = membershipRead.then((m) =>
			m?.role === OrgRole.Advisor
				? this.assignments.isAssigned(ctx.orgId, clientProfileId, ctx.userId)
				: false
		);
		const [membership, relationship, profile, assigned] = await Promise.all([
			membershipRead,
			this.relationships.findByOrgAndClient(ctx.orgId, clientProfileId),
			this.profiles.findById(clientProfileId),
			assignedRead,
		]);

		const decision = canAccessClient({
			membership: membership ?? undefined,
			relationship: relationship ?? undefined,
			profileOrigin: profile?.orgId === ctx.orgId ? profile.origin : undefined,
			assigned,
			action,
		});
		if (decision === 'NOT_ACCESSIBLE') throw new ClientNotAccessibleError();
		if (decision === 'ACTION_FORBIDDEN') throw new ClientActionForbiddenError();

		await this.audit.record({
			eventId: randomUUID(),
			type: CLIENT_ACCESSED_EVENT,
			version: 1,
			subject: clientProfileId,
			actorRef: actorRefOf(ctx.userId),
			occurredAt: new Date(),
			payload: { action, orgId: ctx.orgId },
		});
	}

	/**
	 * Membro da org de ctx (ORG_ADMIN ou ADVISOR), resolvido estritamente em
	 * ctx.orgId. Não audita: serve de porta para operações da própria org.
	 */
	async ensureOrgMember(ctx: AccessContext): Promise<Membership> {
		const membership = await this.memberships.findByUserAndOrg(
			ctx.userId,
			ctx.orgId
		);
		if (!membership || !isAllowedRole(membership.role)) {
			throw new ForbiddenException('Not a member of this organization');
		}
		return membership;
	}

	/** Membro ORG_ADMIN da org de ctx; ADVISOR recebe 403 ROLE_REQUIRED. */
	async ensureOrgAdmin(ctx: AccessContext): Promise<Membership> {
		const membership = await this.ensureOrgMember(ctx);
		if (membership.role !== OrgRole.OrgAdmin) throw new RoleRequiredError();
		return membership;
	}

	/**
	 * O cliente está no alcance do membro: ORG_ADMIN alcança todos os clientes
	 * da org; ADVISOR só os atribuídos a ele. Não confere vínculo nem audita:
	 * serve para filtrar listas e convites já resolvidos em ctx.orgId.
	 */
	async isClientInScope(
		membership: Membership,
		clientProfileId: string
	): Promise<boolean> {
		if (membership.role === OrgRole.OrgAdmin) return true;
		if (membership.role !== OrgRole.Advisor) return false;
		return this.assignments.isAssigned(
			membership.orgId,
			clientProfileId,
			membership.userId
		);
	}
}
