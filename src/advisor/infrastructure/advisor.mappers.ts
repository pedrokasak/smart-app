import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import {
	AdvisorClientProfileDoc,
	AdvisorMembershipDoc,
	AdvisorOrganizationDoc,
	AdvisorRelationshipDoc,
} from './advisor.models';

/**
 * Doc para entidade: `_id` vira `id` e só os campos do domínio saem; campos
 * opcionais ausentes (ou null) ficam fora do objeto.
 */
export function toOrganization(doc: AdvisorOrganizationDoc): Organization {
	return {
		id: doc._id,
		name: doc.name,
		advisorType: doc.advisorType,
		...(doc.plan != null && { plan: doc.plan }),
	};
}

export function toMembership(doc: AdvisorMembershipDoc): Membership {
	return {
		id: doc._id,
		userId: doc.userId,
		orgId: doc.orgId,
		role: doc.role,
	};
}

export function toRelationship(
	doc: AdvisorRelationshipDoc
): AdvisoryRelationship {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		status: doc.status,
		...(doc.consentId != null && { consentId: doc.consentId }),
		...(doc.scope != null && { scope: [...doc.scope] }),
	};
}

export function toClientProfile(doc: AdvisorClientProfileDoc): ClientProfile {
	return {
		id: doc._id,
		orgId: doc.orgId,
		name: doc.name,
		origin: doc.origin,
		...(doc.ownerUserId != null && { ownerUserId: doc.ownerUserId }),
	};
}
