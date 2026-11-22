import { AdvisoryRelationship, Membership } from './entities';
import {
	ClientAction,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from './enums';

export interface AccessInput {
	membership?: Membership;
	relationship?: AdvisoryRelationship;
	profileOrigin?: ProfileOrigin;
	/** O cliente está atribuído ao membro (só importa para ADVISOR). */
	assigned?: boolean;
	action: ClientAction;
}

const ALLOWED_ROLES: readonly OrgRole[] = [OrgRole.OrgAdmin, OrgRole.Advisor];

export function isAllowedRole(role: OrgRole): boolean {
	return ALLOWED_ROLES.includes(role);
}

export type AccessDecision = 'ALLOWED' | 'NOT_ACCESSIBLE' | 'ACTION_FORBIDDEN';

/** Ações que nenhuma origem de perfil libera ainda (só a P3c libera). */
const BLOCKED_ACTIONS: readonly ClientAction[] = ['PUBLISH_REPORT'];

/** Ações de escrita: só em perfil criado pelo assessor. */
const ADVISOR_ONLY_ACTIONS: readonly ClientAction[] = ['EDIT_POSITION'];

/**
 * Core authorization invariant of the advisor context: an actor may touch a
 * client only through a membership of the SAME org that holds an ACTIVE
 * advisory relationship with that client, and whose profile is known. Any
 * missing piece is NOT_ACCESSIBLE; once reachable, the action may still be
 * refused by the profile origin (ACTION_FORBIDDEN).
 */
export function canAccessClient(input: AccessInput): AccessDecision {
	const { membership, relationship, profileOrigin, assigned, action } = input;
	if (!membership || !relationship || !profileOrigin) return 'NOT_ACCESSIBLE';
	if (!isAllowedRole(membership.role)) return 'NOT_ACCESSIBLE';
	if (relationship.status !== RelationshipStatus.Active) {
		return 'NOT_ACCESSIBLE';
	}
	if (relationship.orgId !== membership.orgId) return 'NOT_ACCESSIBLE';
	// ADVISOR só alcança clientes atribuídos a ele; ORG_ADMIN ignora a atribuição.
	if (membership.role === OrgRole.Advisor && assigned !== true) {
		return 'NOT_ACCESSIBLE';
	}
	if (BLOCKED_ACTIONS.includes(action)) return 'ACTION_FORBIDDEN';
	if (
		ADVISOR_ONLY_ACTIONS.includes(action) &&
		profileOrigin !== ProfileOrigin.AdvisorCreated
	) {
		return 'ACTION_FORBIDDEN';
	}
	return 'ALLOWED';
}
