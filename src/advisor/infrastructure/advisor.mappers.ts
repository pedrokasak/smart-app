import { ClientInvite, Consent } from '../domain/consent.entities';
import { DEFAULT_ALERT_SETTINGS } from '../domain/alert-settings';
import {
	Alert,
	ClientSnapshot,
	SourceSnapshot,
} from '../domain/attention.entities';
import { StoredAlertSettings } from '../application/ports/alert-settings.store.port';
import {
	AdvisorAlertDoc,
	AdvisorAlertSettingsDoc,
	AdvisorClientSnapshotDoc,
} from './advisor-attention.models';
import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import { PortalGrant } from '../domain/portal-access';
import { ClientAssignment, MemberInvite } from '../domain/team.entities';
import { AllocationTarget, Transaction } from '../domain/portfolio.entities';
import { AdvisorPortalGrantDoc } from './advisor-portal-grant.models';
import {
	AdvisorClientAssignmentDoc,
	AdvisorMemberInviteDoc,
} from './advisor-team.models';
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
		...(doc.ownerUserId != null && { ownerUserId: doc.ownerUserId }),
	};
}

export function toMembership(doc: AdvisorMembershipDoc): Membership {
	return {
		id: doc._id,
		userId: doc.userId,
		orgId: doc.orgId,
		role: doc.role,
		createdAt: doc.createdAt,
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

/** `active` é detalhe do índice e não sai do store. */
export function toPortalGrant(doc: AdvisorPortalGrantDoc): PortalGrant {
	return {
		id: doc._id,
		userId: doc.userId,
		grantedBy: doc.grantedBy,
		grantedAt: doc.grantedAt,
		...(doc.revokedAt != null && { revokedAt: doc.revokedAt }),
	};
}

export function toClientAssignment(
	doc: AdvisorClientAssignmentDoc
): ClientAssignment {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		userId: doc.userId,
		assignedBy: doc.assignedBy,
		createdAt: doc.createdAt,
	};
}

export function toMemberInvite(doc: AdvisorMemberInviteDoc): MemberInvite {
	return {
		id: doc._id,
		orgId: doc.orgId,
		email: doc.email,
		role: doc.role,
		tokenHash: doc.tokenHash,
		status: doc.status,
		expiresAt: doc.expiresAt,
		resendCount: doc.resendCount,
		invitedByUserId: doc.invitedByUserId,
		createdAt: doc.createdAt,
		...(doc.respondedAt != null && { respondedAt: doc.respondedAt }),
	};
}

export function toClientSnapshot(
	doc: AdvisorClientSnapshotDoc
): ClientSnapshot {
	return {
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		asOf: doc.asOf,
		sources: doc.sources as SourceSnapshot[],
		totalMinor: doc.totalMinor,
		verifiedMinor: doc.verifiedMinor,
		manualMinor: doc.manualMinor,
		relationshipStartedAt: doc.relationshipStartedAt,
		lastContactAt: doc.lastContactAt ?? null,
		computedAt: doc.computedAt,
	};
}

/** `priorityRank` e `active` são derivados e não saem do store. */
export function toAlert(doc: AdvisorAlertDoc): Alert {
	return {
		id: doc._id,
		orgId: doc.orgId,
		clientProfileId: doc.clientProfileId,
		rule: doc.rule,
		source: doc.source ?? null,
		key: doc.key,
		conditionKey: doc.conditionKey,
		band: doc.band,
		priority: doc.priority,
		messageKey: doc.messageKey,
		params: doc.params,
		evidence: doc.evidence,
		dataAsOf: doc.dataAsOf,
		provenance: doc.provenance ?? null,
		lowConfidence: doc.lowConfidence,
		status: doc.status,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
		...(doc.createdByUserId != null && {
			createdByUserId: doc.createdByUserId,
		}),
		...(doc.title != null && { title: doc.title }),
		...(doc.note != null && { note: doc.note }),
		...(doc.dueDate != null && { dueDate: doc.dueDate }),
		...(doc.snoozedUntil != null && { snoozedUntil: doc.snoozedUntil }),
		...(doc.handledVia != null && { handledVia: doc.handledVia }),
		...(doc.handledByUserId != null && {
			handledByUserId: doc.handledByUserId,
		}),
		...(doc.dismissReason != null && { dismissReason: doc.dismissReason }),
		...(doc.closedAt != null && { closedAt: doc.closedAt }),
	};
}

export function toStoredAlertSettings(
	doc: AdvisorAlertSettingsDoc
): StoredAlertSettings {
	return {
		settings: doc.settings ?? structuredClone(DEFAULT_ALERT_SETTINGS),
		engineEnabledAt: doc.engineEnabledAt,
		...(doc.updatedByUserId != null && {
			updatedByUserId: doc.updatedByUserId,
		}),
		...(doc.updatedAt != null && { updatedAt: doc.updatedAt }),
	};
}
