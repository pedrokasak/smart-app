import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import { AllocationTarget, Transaction } from '../domain/portfolio.entities';
import {
	AdvisorAllocationTargetDoc,
	AdvisorTransactionDoc,
} from './advisor-portfolio.models';
import {
	AdvisorClientProfileDoc,
	AdvisorMembershipDoc,
	AdvisorOrganizationDoc,
	AdvisorRelationshipDoc,
} from './advisor.models';
import {
	AdvisorClientInviteDoc,
	AdvisorConsentDoc,
} from './advisor-consent.models';

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

/** `seq` e timestamps de atualização são detalhe de persistência: não saem. */
export function toTransaction(doc: AdvisorTransactionDoc): Transaction {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		symbol: doc.symbol,
		assetClass: doc.assetClass,
		side: doc.side,
		quantity: doc.quantity,
		unitPriceMinor: doc.unitPriceMinor,
		feesMinor: doc.feesMinor,
		currency: doc.currency,
		tradeDate: doc.tradeDate,
		...(doc.liquidityDays != null && { liquidityDays: doc.liquidityDays }),
		provenance: doc.provenance,
		source: doc.source,
		...(doc.importBatchId != null && { importBatchId: doc.importBatchId }),
		createdByUserId: doc.createdByUserId,
		createdAt: doc.createdAt,
	};
}

export function toAllocationTarget(
	doc: AdvisorAllocationTargetDoc
): AllocationTarget {
	return {
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		targets: { ...doc.targets },
		updatedByUserId: doc.updatedByUserId,
		updatedAt: doc.updatedAt,
	};
}

export function toClientInvite(doc: AdvisorClientInviteDoc): ClientInvite {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		relationshipId: doc.relationshipId,
		email: doc.email,
		tokenHash: doc.tokenHash,
		status: doc.status,
		expiresAt: doc.expiresAt,
		resendCount: doc.resendCount,
		invitedByUserId: doc.invitedByUserId,
		createdAt: doc.createdAt,
		...(doc.respondedAt != null && { respondedAt: doc.respondedAt }),
	};
}

export function toConsent(doc: AdvisorConsentDoc): Consent {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		relationshipId: doc.relationshipId,
		userId: doc.userId,
		portfolioIds: [...doc.portfolioIds],
		version: doc.version,
		textVersion: doc.textVersion,
		status: doc.status,
		grantedAt: doc.grantedAt,
		...(doc.endedAt != null && { endedAt: doc.endedAt }),
	};
}
