import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { canAccessClient } from '../domain/access-policy';
import { ClientAction } from '../domain/enums';
import {
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
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
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	/**
	 * Resolves the membership strictly in ctx.orgId (no fallback to another
	 * org) and the relationship for (orgId, client), then applies the access
	 * policy. Denial throws without auditing; success is audited and, if the
	 * audit cannot be written, the access is refused too (fail closed).
	 */
	async ensureCanAccessClient(
		ctx: AccessContext,
		clientProfileId: string,
		action: ClientAction
	): Promise<void> {
		const [membership, relationship] = await Promise.all([
			this.memberships.findByUserAndOrg(ctx.userId, ctx.orgId),
			this.relationships.findByOrgAndClient(ctx.orgId, clientProfileId),
		]);

		const allowed = canAccessClient({
			membership: membership ?? undefined,
			relationship: relationship ?? undefined,
			action,
		});
		if (!allowed) {
			throw new ForbiddenException('Access to this client is not allowed');
		}

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
}
