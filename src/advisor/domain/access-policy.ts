import { AdvisoryRelationship, Membership } from './entities';
import { ClientAction, OrgRole, RelationshipStatus } from './enums';

export interface AccessInput {
	membership?: Membership;
	relationship?: AdvisoryRelationship;
	action: ClientAction;
}

const ALLOWED_ROLES: readonly OrgRole[] = [OrgRole.OrgAdmin, OrgRole.Advisor];

/**
 * Core authorization invariant of the advisor context: an actor may touch a
 * client only through a membership of the SAME org that holds an ACTIVE
 * advisory relationship with that client. Any missing piece denies.
 */
export function canAccessClient(input: AccessInput): boolean {
	const { membership, relationship } = input;
	if (!membership || !relationship) return false;
	if (!ALLOWED_ROLES.includes(membership.role)) return false;
	if (relationship.status !== RelationshipStatus.Active) return false;
	return relationship.orgId === membership.orgId;
}
