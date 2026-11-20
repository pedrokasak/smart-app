import {
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { ClientInvite, Consent } from '../domain/consent.entities';
import { AdvisoryRelationship, Organization } from '../domain/entities';
import { AdvisorType, InviteStatus, RelationshipStatus } from '../domain/enums';
import {
	CONSENT_TEXT_VERSION,
	emailMatches,
	hashInviteToken,
	inviteUsability,
	maskEmail,
	PortfolioSelectionResult,
	validatePortfolioSelection,
} from '../domain/invite-rules';
import {
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { ConsentStorePort } from './ports/consent.store.port';
import type { InviteStorePort } from './ports/invite.store.port';
import { ADVISOR_INVITEE_IDENTITY } from './ports/invitee-identity.port';
import type { InviteeIdentityPort } from './ports/invitee-identity.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import type { RelationshipStorePort } from './ports/relationship.store.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from './ports/shared-portfolio-source.port';
import type {
	OwnedPortfolio,
	SharedPortfolioSourcePort,
} from './ports/shared-portfolio-source.port';
import { RelationshipService } from './relationship.service';

export const CONSENT_GRANTED_EVENT = 'advisor.consent.granted';
export const CONSENT_CHANGED_EVENT = 'advisor.consent.scope_changed';
export const CONSENT_REVOKED_EVENT = 'advisor.consent.revoked';
export const INVITE_DECLINED_EVENT = 'advisor.invite.declined';

/** Same message for every gate failure: nothing tells why the token failed. */
export class InviteNotFoundError extends NotFoundException {
	constructor() {
		super('Invite not found');
	}
}

export class InvalidPortfolioSelectionError extends UnprocessableEntityException {
	constructor(reason: Exclude<PortfolioSelectionResult, 'OK'>) {
		super({ reason });
	}
}

export interface InvitePreview {
	organizationName: string;
	advisorType: AdvisorType;
	invitedEmailMasked: string;
	expiresAt: Date;
	portfolios: OwnedPortfolio[];
	consentTextVersion: string;
}

export interface AccessGrant {
	relationshipId: string;
	organizationName: string;
	advisorType: AdvisorType;
	portfolioIds: string[];
	grantedAt: Date;
	consentVersion: number;
}

/**
 * Investor side of the advisor link. The investor id always comes from the
 * caller (authenticated session), never from the invite or the body.
 */
@Injectable()
export class ConsentService {
	private readonly logger = new Logger(ConsentService.name);

	constructor(
		@Inject(ADVISOR_INVITE_STORE) private readonly invites: InviteStorePort,
		@Inject(ADVISOR_CONSENT_STORE) private readonly consents: ConsentStorePort,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationshipStore: RelationshipStorePort,
		private readonly relationships: RelationshipService,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		@Inject(ADVISOR_INVITEE_IDENTITY)
		private readonly identity: InviteeIdentityPort,
		@Inject(ADVISOR_SHARED_PORTFOLIO_SOURCE)
		private readonly portfolios: SharedPortfolioSourcePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async previewInvite(userId: string, token: string): Promise<InvitePreview> {
		const invite = await this.openInvite(userId, token);
		const org = await this.orgOfInvite(invite);
		return {
			organizationName: org.name,
			advisorType: org.advisorType,
			invitedEmailMasked: maskEmail(invite.email),
			expiresAt: invite.expiresAt,
			portfolios: await this.portfolios.listOwned(userId),
			consentTextVersion: CONSENT_TEXT_VERSION,
		};
	}

	/**
	 * Order matters: validation first (nothing written on failure), then the
	 * invite transition, the single gate that makes the token single-use, and
	 * only then the grant. The relationship becomes ACTIVE last, after the
	 * audit. Any failure after the transition revokes what was granted and
	 * rethrows; the invite stays ACCEPTED (spent).
	 */
	async acceptInvite(
		userId: string,
		token: string,
		portfolioIds: string[]
	): Promise<AccessGrant> {
		const invite = await this.openInvite(userId, token);
		const selected = await this.validSelection(userId, portfolioIds);
		const linked = await this.consents.listActiveByUser(userId);
		if (linked.some((c) => c.orgId === invite.orgId)) {
			throw new ConflictException('Already linked to this organization');
		}
		const org = await this.orgOfInvite(invite);

		const now = new Date();
		const accepted = await this.invites.transition(
			invite.id,
			InviteStatus.Accepted,
			now
		);
		if (!accepted) throw new InviteNotFoundError();

		let consent: Consent | undefined;
		try {
			await this.ensureProfileOwner(accepted.clientProfileId, userId);
			consent = await this.consents.grant({
				orgId: accepted.orgId,
				clientProfileId: accepted.clientProfileId,
				relationshipId: accepted.relationshipId,
				userId,
				portfolioIds: selected,
				textVersion: CONSENT_TEXT_VERSION,
				grantedAt: now,
			});
			// Fail closed: without the audit record nobody gets access.
			await this.record(CONSENT_GRANTED_EVENT, userId, consent);
			const active = await this.relationshipStore.activate(
				accepted.relationshipId,
				consent.id
			);
			if (!active) {
				throw new ConflictException('Advisory relationship is not pending');
			}
		} catch (error) {
			await this.undoAccept(accepted, userId, consent);
			throw error;
		}
		return toGrant(consent, org);
	}

	async declineInvite(userId: string, token: string): Promise<void> {
		const invite = await this.openInvite(userId, token);
		const declined = await this.invites.transition(
			invite.id,
			InviteStatus.Declined,
			new Date()
		);
		if (!declined) throw new InviteNotFoundError();
		await this.relationships.revokePending(declined.relationshipId);
		await this.recordEnding(INVITE_DECLINED_EVENT, userId, declined);
	}

	async listMyGrants(userId: string): Promise<AccessGrant[]> {
		const active = await this.consents.listActiveByUser(userId);
		const grants = await Promise.all(
			active.map(async (consent) => {
				const relationship = await this.relationshipStore.findById(
					consent.relationshipId
				);
				if (relationship?.status !== RelationshipStatus.Active) return null;
				const org = await this.orgs.findById(consent.orgId);
				return org ? toGrant(consent, org) : null;
			})
		);
		return grants.filter((g): g is AccessGrant => g !== null);
	}

	/**
	 * New consent version with the new scope. The audit comes before the
	 * relationship points at it; if the audit fails, the previous scope is
	 * granted again (a new version, history kept) and the error rethrown.
	 */
	async changeSharedPortfolios(
		userId: string,
		relationshipId: string,
		portfolioIds: string[]
	): Promise<AccessGrant> {
		const { consent: previous, relationship } = await this.activeLinkOf(
			userId,
			relationshipId
		);
		const selected = await this.validSelection(userId, portfolioIds);
		const org = await this.orgs.findById(previous.orgId);
		if (!org) throw new NotFoundException('Advisory relationship not found');

		const consent = await this.consents.grant({
			orgId: previous.orgId,
			clientProfileId: previous.clientProfileId,
			relationshipId: previous.relationshipId,
			userId,
			portfolioIds: selected,
			textVersion: CONSENT_TEXT_VERSION,
			grantedAt: new Date(),
		});
		try {
			await this.record(CONSENT_CHANGED_EVENT, userId, consent);
		} catch (error) {
			await this.restoreScope(previous, relationship);
			throw error;
		}
		await this.relationshipStore.save({
			...relationship,
			consentId: consent.id,
		});
		return toGrant(consent, org);
	}

	/**
	 * The ownership check comes first; then the relationship (the access
	 * gate) is revoked before the consent, so a failure in between never
	 * leaves the advisor with access and a retry finishes the job. A failed
	 * audit does not undo the revocation.
	 */
	async revoke(userId: string, relationshipId: string): Promise<void> {
		const { consent } = await this.activeLinkOf(userId, relationshipId, {
			anyRelationshipStatus: true,
		});
		await this.endLink(userId, consent);
	}

	/** LGPD: ends every active link of the user. Used by account erasure. */
	async revokeAllForUser(userId: string): Promise<{ revoked: number }> {
		const active = await this.consents.listActiveByUser(userId);
		let revoked = 0;
		for (const consent of active) {
			if (await this.endLink(userId, consent)) revoked += 1;
		}
		return { revoked };
	}

	/**
	 * Common gate: token -> invite -> usable -> verified account with the
	 * invited e-mail. Every failure is the same InviteNotFoundError. An expired
	 * PENDING invite found here is closed as EXPIRED.
	 */
	private async openInvite(
		userId: string,
		token: string
	): Promise<ClientInvite> {
		if (typeof token !== 'string' || token.length === 0) {
			throw new InviteNotFoundError();
		}
		const invite = await this.invites.findByTokenHash(hashInviteToken(token));
		if (!invite) throw new InviteNotFoundError();

		const now = new Date();
		const usability = inviteUsability(invite, now);
		if (usability === 'EXPIRED') {
			await this.invites.transition(invite.id, InviteStatus.Expired, now);
		}
		if (usability !== 'OK') throw new InviteNotFoundError();

		const account = await this.identity.find(userId);
		if (
			!account ||
			typeof account.email !== 'string' ||
			account.emailVerified !== true ||
			!emailMatches(invite, account.email)
		) {
			throw new InviteNotFoundError();
		}
		return invite;
	}

	private async orgOfInvite(invite: ClientInvite): Promise<Organization> {
		const org = await this.orgs.findById(invite.orgId);
		if (!org) throw new InviteNotFoundError();
		return org;
	}

	private async validSelection(
		userId: string,
		portfolioIds: string[]
	): Promise<string[]> {
		const selected = Array.isArray(portfolioIds) ? [...portfolioIds] : [];
		const owned = await this.portfolios.listOwned(userId);
		const result = validatePortfolioSelection(
			selected,
			owned.map((p) => p.id)
		);
		if (result !== 'OK') throw new InvalidPortfolioSelectionError(result);
		return selected;
	}

	/** The ACTIVE consent of the relationship, only if it is the user's. */
	private async activeLinkOf(
		userId: string,
		relationshipId: string,
		options: { anyRelationshipStatus?: boolean } = {}
	): Promise<{ consent: Consent; relationship: AdvisoryRelationship }> {
		const consent =
			await this.consents.findActiveByRelationship(relationshipId);
		if (!consent || consent.userId !== userId) {
			throw new NotFoundException('Advisory relationship not found');
		}
		const relationship = await this.relationshipStore.findById(relationshipId);
		if (
			!options.anyRelationshipStatus &&
			relationship?.status !== RelationshipStatus.Active
		) {
			throw new NotFoundException('Advisory relationship not found');
		}
		return { consent, relationship };
	}

	/** Invite profiles are CLIENT_CREATED without owner; the owner never changes. */
	private async ensureProfileOwner(
		clientProfileId: string,
		userId: string
	): Promise<void> {
		const owned = await this.profiles.setOwnerIfUnowned(
			clientProfileId,
			userId
		);
		if (owned) return;
		const profile = await this.profiles.findById(clientProfileId);
		if (profile?.ownerUserId !== userId) {
			throw new ConflictException('Client profile belongs to someone else');
		}
	}

	/**
	 * Revokes the relationship, then the consent; audits without failing.
	 * Returns false when a concurrent call had already ended the consent.
	 */
	private async endLink(userId: string, consent: Consent): Promise<boolean> {
		await this.revokeRelationship(consent.relationshipId);
		const revoked = await this.consents.revokeActive(
			consent.relationshipId,
			userId,
			new Date()
		);
		if (!revoked) return false;
		await this.recordEnding(CONSENT_REVOKED_EVENT, userId, revoked);
		return true;
	}

	/** A missing relationship grants nothing: treat it as already revoked. */
	private async revokeRelationship(relationshipId: string): Promise<void> {
		try {
			await this.relationships.revoke(relationshipId);
		} catch (error) {
			if (!(error instanceof NotFoundException)) throw error;
		}
	}

	/** Compensation of acceptInvite: best effort per step, ids-only logs. */
	private async undoAccept(
		invite: ClientInvite,
		userId: string,
		consent: Consent | undefined
	): Promise<void> {
		if (consent) {
			try {
				await this.consents.revokeActive(
					invite.relationshipId,
					userId,
					new Date()
				);
			} catch (error) {
				this.logFailure('revoke consent of invite', invite.id, error);
			}
		}
		try {
			await this.revokeRelationship(invite.relationshipId);
		} catch (error) {
			this.logFailure('revoke relationship of invite', invite.id, error);
		}
	}

	/** Compensation of changeSharedPortfolios: grants the previous scope again. */
	private async restoreScope(
		previous: Consent,
		relationship: AdvisoryRelationship
	): Promise<void> {
		try {
			const restored = await this.consents.grant({
				orgId: previous.orgId,
				clientProfileId: previous.clientProfileId,
				relationshipId: previous.relationshipId,
				userId: previous.userId,
				portfolioIds: previous.portfolioIds,
				textVersion: previous.textVersion,
				grantedAt: new Date(),
			});
			await this.relationshipStore.save({
				...relationship,
				consentId: restored.id,
			});
		} catch (error) {
			this.logFailure(
				'restore consent scope of relationship',
				previous.relationshipId,
				error
			);
		}
	}

	/** Payload carries counts only: no e-mail, name or portfolio id. */
	private async record(
		type: string,
		userId: string,
		consent: Consent
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject: consent.clientProfileId,
			actorRef: actorRefOf(userId),
			occurredAt: new Date(),
			payload: {
				orgId: consent.orgId,
				portfolioCount: consent.portfolioIds.length,
				consentVersion: consent.version,
			},
		});
	}

	/** Ending access stands even if the audit fails: log it and move on. */
	private async recordEnding(
		type: string,
		userId: string,
		target: { orgId: string; clientProfileId: string; relationshipId: string }
	): Promise<void> {
		try {
			await this.audit.record({
				eventId: randomUUID(),
				type,
				version: 1,
				subject: target.clientProfileId,
				actorRef: actorRefOf(userId),
				occurredAt: new Date(),
				payload: { orgId: target.orgId },
			});
		} catch (error) {
			this.logFailure(
				`audit ${type} of relationship`,
				target.relationshipId,
				error
			);
		}
	}

	private logFailure(step: string, id: string, error: unknown): void {
		this.logger.error(
			`Failed to ${step} ${id}: ${
				error instanceof Error ? error.name : 'unknown'
			}`
		);
	}
}

function toGrant(consent: Consent, org: Organization): AccessGrant {
	return {
		relationshipId: consent.relationshipId,
		organizationName: org.name,
		advisorType: org.advisorType,
		portfolioIds: [...consent.portfolioIds],
		grantedAt: consent.grantedAt,
		consentVersion: consent.version,
	};
}
