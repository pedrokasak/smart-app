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
import {
	AdvisorType,
	ConsentStatus,
	InviteStatus,
	RelationshipStatus,
} from '../domain/enums';
import {
	CONSENT_TEXT_VERSION,
	emailMatches,
	hashInviteToken,
	inviteUsability,
	isValidEmail,
	maskEmail,
	normalizeEmail,
	PortfolioSelectionResult,
	validatePortfolioSelection,
} from '../domain/invite-rules';
import {
	ADVISOR_ATTENTION_PURGE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_SNAPSHOT_TRIGGER,
} from './advisor.tokens';
import type { ClientAttentionPurgePort } from './ports/client-attention-purge.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { ClientSnapshotTriggerPort } from './ports/client-snapshot-trigger.port';
import type { ConsentStorePort } from './ports/consent.store.port';
import type { InviteStorePort } from './ports/invite.store.port';
import { ADVISOR_INVITEE_IDENTITY } from './ports/invitee-identity.port';
import type { InviteeIdentityPort } from './ports/invitee-identity.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import { ADVISOR_RELATIONSHIP_NOTIFIER } from './ports/relationship-notifier.port';
import type {
	RelationshipNotifierPort,
	RelationshipUpdateKind,
} from './ports/relationship-notifier.port';
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

/** The investor read an outdated consent text: reload the preview first. */
export class ConsentTextChangedError extends ConflictException {
	constructor() {
		super({
			statusCode: 409,
			error: 'CONSENT_TEXT_CHANGED',
			reason: 'CONSENT_TEXT_CHANGED',
			message: 'The consent text changed; review it again before accepting',
		});
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
 * What account erasure removed. `invites` counts the invites of the user's
 * relationships plus, when the e-mail is known, the ones sent to it.
 */
export interface UserErasure {
	revoked: number;
	consents: number;
	invites: number;
	profiles: number;
}

/** LGPD export: the consent and the org name, nothing internal of the org. */
export interface ConsentRecord {
	organizationName: string | null;
	portfolioIds: string[];
	status: ConsentStatus;
	version: number;
	textVersion: string;
	grantedAt: Date;
	endedAt: Date | null;
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
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
		@Inject(ADVISOR_SNAPSHOT_TRIGGER)
		private readonly snapshotTrigger: ClientSnapshotTriggerPort,
		@Inject(ADVISOR_ATTENTION_PURGE)
		private readonly attention: ClientAttentionPurgePort,
		@Inject(ADVISOR_RELATIONSHIP_NOTIFIER)
		private readonly notifier: RelationshipNotifierPort
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
		portfolioIds: string[],
		consentTextVersion?: string
	): Promise<AccessGrant> {
		const invite = await this.openInvite(userId, token);
		if (
			consentTextVersion !== undefined &&
			consentTextVersion !== null &&
			consentTextVersion !== CONSENT_TEXT_VERSION
		) {
			throw new ConsentTextChangedError();
		}
		const selected = await this.validSelection(userId, portfolioIds);
		await this.ensureNotLinked(userId, invite.orgId);
		const org = await this.orgOfInvite(invite);

		const now = new Date();
		const accepted = await this.invites.transition(
			invite.id,
			InviteStatus.Accepted,
			now
		);
		if (!accepted) throw new InviteNotFoundError();

		let consent: Consent | undefined;
		let audited = false;
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
			await this.record(CONSENT_GRANTED_EVENT, userId, scopeOf(consent));
			audited = true;
			const active = await this.relationshipStore.activate(
				accepted.relationshipId,
				consent.id
			);
			if (!active) {
				throw new ConflictException('Advisory relationship is not pending');
			}
		} catch (error) {
			await this.undoAccept(accepted, userId, consent, audited);
			throw error;
		}
		this.snapshotTrigger.request(accepted.orgId, accepted.clientProfileId);
		this.notifyAdvisors(accepted, 'ACCEPTED');
		await this.proveInviteeEmail(userId, accepted.email);
		return toGrant(consent, org);
	}

	/**
	 * The invite token went to this address, so accepting it proves the
	 * invitee reads it. Best effort: the accept is already complete, so a
	 * failure here is logged (ids and error name only) and never undone.
	 */
	private async proveInviteeEmail(
		userId: string,
		inviteEmail: string
	): Promise<void> {
		try {
			await this.identity.markEmailVerified(
				userId,
				normalizeEmail(inviteEmail)
			);
		} catch (error) {
			this.logFailure('mark e-mail verified of user', userId, error);
		}
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
		this.notifyAdvisors(declined, 'DECLINED');
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
	 * New consent version with the new scope. The audit comes FIRST (fail
	 * closed: a failed audit grants nothing). The relationship is never saved
	 * from a snapshot: `setConsentIfActive` only points an ACTIVE relationship
	 * at the new consent, so a revoke that lands mid-flight wins and the new
	 * consent is revoked again. An audit event may then describe a change that
	 * did not complete; that is accepted. A grant that fails after the store
	 * superseded the old consent leaves no ACTIVE consent: the relationship is
	 * then revoked too, so it never stays ACTIVE with nothing behind it.
	 */
	async changeSharedPortfolios(
		userId: string,
		relationshipId: string,
		portfolioIds: string[]
	): Promise<AccessGrant> {
		const { consent: previous } = await this.activeLinkOf(
			userId,
			relationshipId
		);
		const selected = await this.validSelection(userId, portfolioIds);
		const org = await this.orgs.findById(previous.orgId);
		if (!org) throw new NotFoundException('Advisory relationship not found');

		await this.record(CONSENT_CHANGED_EVENT, userId, {
			orgId: previous.orgId,
			clientProfileId: previous.clientProfileId,
			portfolioCount: selected.length,
			consentVersion: previous.version + 1,
		});
		let consent: Consent;
		try {
			consent = await this.consents.grant({
				orgId: previous.orgId,
				clientProfileId: previous.clientProfileId,
				relationshipId: previous.relationshipId,
				userId,
				portfolioIds: selected,
				textVersion: CONSENT_TEXT_VERSION,
				grantedAt: new Date(),
			});
		} catch (error) {
			await this.closeIfUnconsented(userId, previous);
			throw error;
		}
		const pointed = await this.relationshipStore.setConsentIfActive(
			previous.relationshipId,
			consent.id
		);
		if (!pointed) {
			try {
				await this.consents.revokeActive(
					previous.relationshipId,
					userId,
					new Date()
				);
			} catch (error) {
				this.logFailure(
					'revoke orphan consent of relationship',
					previous.relationshipId,
					error
				);
			}
			throw new NotFoundException('Advisory relationship not found');
		}
		this.snapshotTrigger.request(consent.orgId, consent.clientProfileId);
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
		// Sem relação ACTIVE, a recomputação resolve os alertas do sistema e
		// mantém os manuais do assessor.
		this.snapshotTrigger.request(consent.orgId, consent.clientProfileId);
		this.notifyAdvisors(consent, 'REVOKED');
	}

	/**
	 * LGPD: ends every active link of the user and purges the advisor's
	 * attention read model of each client right away (not on the daily job).
	 * Used by account erasure.
	 */
	async revokeAllForUser(userId: string): Promise<{ revoked: number }> {
		const active = await this.consents.listActiveByUser(userId);
		let revoked = 0;
		let firstError: unknown;
		// One failing link never stops the others; the first error is rethrown
		// at the end so the caller (erasure) can retry.
		for (const consent of active) {
			try {
				if (await this.endLink(userId, consent)) revoked += 1;
				await this.purgeAttention(consent.orgId, consent.clientProfileId);
			} catch (error) {
				this.logFailure('revoke link', consent.relationshipId, error);
				firstError ??= error;
			}
		}
		if (firstError !== undefined) {
			this.logger.error(`Revoked ${revoked} of ${active.length} links`);
			throw firstError;
		}
		return { revoked };
	}

	/**
	 * LGPD: the one method account erasure calls. Order: end every
	 * link first, including ACTIVE relationships of the user's profiles that
	 * no ACTIVE consent reaches (a failure aborts before anything is removed,
	 * so a retry starts clean), then delete consents, then the invites of
	 * those consents' relationships and the ones sent to the account e-mail,
	 * then detach the client profiles from the user. The e-mail must be read
	 * by the caller before the account is deleted.
	 */
	async eraseUser(
		userId: string,
		email: string | undefined
	): Promise<UserErasure> {
		const { revoked: byConsent } = await this.revokeAllForUser(userId);
		const orphans = await this.revokeOwnedRelationships(userId);
		const userConsents = await this.consents.listByUser(userId);
		const clients = await this.purgeAttentionOfUser(userId, userConsents);
		const relationshipIds = [
			...new Set(userConsents.map((c) => c.relationshipId)),
		];
		const consents = await this.consents.deleteByUser(userId);
		const invites =
			(await this.invites.deleteByRelationshipIds(relationshipIds)) +
			(await this.deleteInvitesOf(userId, email));
		const profiles = await this.profiles.anonymizeByOwner(userId);
		await this.purgeAgainAfterAnonymizing(clients);
		return { revoked: byConsent + orphans, consents, invites, profiles };
	}

	/**
	 * A recomputation that was running during the first purge may have
	 * written again before the profiles were anonymized (after that, its own
	 * re-check purges). Best effort: the profile is already erased, so the
	 * requested recompute purges anyway if this one fails (ids-only log).
	 */
	private async purgeAgainAfterAnonymizing(
		clients: Array<{ orgId: string; clientProfileId: string }>
	): Promise<void> {
		for (const { orgId, clientProfileId } of clients) {
			try {
				await this.attention.purgeClient(orgId, clientProfileId);
			} catch (error) {
				this.logFailure('purge attention of client', clientProfileId, error);
			}
			this.snapshotTrigger.request(orgId, clientProfileId);
		}
	}

	/**
	 * LGPD: purges the attention read model of every client of the user: the
	 * ones of any consent version and the profiles the user owns. Runs before
	 * the consents are deleted, so a failure aborts and a retry finds them.
	 */
	private async purgeAttentionOfUser(
		userId: string,
		userConsents: Consent[]
	): Promise<Array<{ orgId: string; clientProfileId: string }>> {
		const clients = new Map<
			string,
			{ orgId: string; clientProfileId: string }
		>();
		const add = (orgId: string, clientProfileId: string) =>
			clients.set(`${orgId}:${clientProfileId}`, { orgId, clientProfileId });
		for (const c of userConsents) add(c.orgId, c.clientProfileId);
		for (const id of await this.profiles.listIdsByOwner(userId)) {
			const profile = await this.profiles.findById(id);
			if (profile) add(profile.orgId, profile.id);
		}
		for (const { orgId, clientProfileId } of clients.values()) {
			await this.purgeAttention(orgId, clientProfileId);
		}
		return [...clients.values()];
	}

	/**
	 * Synchronous purge, then a recompute request: a recompute already in
	 * flight could write the snapshot back after the purge, and the next one
	 * (no ACTIVE relationship) removes it again.
	 */
	private async purgeAttention(
		orgId: string,
		clientProfileId: string
	): Promise<void> {
		await this.attention.purgeClient(orgId, clientProfileId);
		this.snapshotTrigger.request(orgId, clientProfileId);
	}

	/** LGPD export: every consent version of the user, any status. */
	async exportForUser(userId: string): Promise<ConsentRecord[]> {
		const consents = await this.consents.listByUser(userId);
		const orgIds = [...new Set(consents.map((c) => c.orgId))];
		const orgs = await Promise.all(orgIds.map((id) => this.orgs.findById(id)));
		const names = new Map(orgIds.map((id, i) => [id, orgs[i]?.name ?? null]));
		return [...consents]
			.sort(
				(a, b) =>
					a.grantedAt.getTime() - b.grantedAt.getTime() || a.version - b.version
			)
			.map((consent) => ({
				organizationName: names.get(consent.orgId) ?? null,
				portfolioIds: [...consent.portfolioIds],
				status: consent.status,
				version: consent.version,
				textVersion: consent.textVersion,
				grantedAt: consent.grantedAt,
				endedAt: consent.endedAt ?? null,
			}));
	}

	/**
	 * Common gate: token -> invite -> usable -> account with the invited
	 * e-mail. No verified flag is required: the token itself proves the e-mail,
	 * since it was only sent there. Every failure is the same
	 * InviteNotFoundError. An expired PENDING invite found here is closed as
	 * EXPIRED.
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
	 * The revocation is audited whenever this call ended either of them.
	 * Returns false when a concurrent call had already ended the consent.
	 */
	private async endLink(userId: string, consent: Consent): Promise<boolean> {
		const ended = await this.revokeRelationship(consent.relationshipId);
		const revoked = await this.consents.revokeActive(
			consent.relationshipId,
			userId,
			new Date()
		);
		if (revoked || ended) {
			await this.recordEnding(
				CONSENT_REVOKED_EVENT,
				userId,
				revoked ?? consent
			);
		}
		return revoked !== null;
	}

	/**
	 * A missing relationship grants nothing: treat it as already revoked.
	 * Returns true when this call moved it to REVOKED.
	 */
	private async revokeRelationship(relationshipId: string): Promise<boolean> {
		try {
			return await this.relationships.revoke(relationshipId);
		} catch (error) {
			if (!(error instanceof NotFoundException)) throw error;
			return false;
		}
	}

	/**
	 * Self-heal before the conflict check: a same-org ACTIVE consent whose
	 * relationship is REVOKED (or gone) grants nothing and is ended here.
	 * A PENDING relationship is an accept in flight and still conflicts.
	 */
	private async ensureNotLinked(userId: string, orgId: string): Promise<void> {
		const linked = await this.consents.listActiveByUser(userId);
		for (const consent of linked.filter((c) => c.orgId === orgId)) {
			const relationship = await this.relationshipStore.findById(
				consent.relationshipId
			);
			if (relationship && relationship.status !== RelationshipStatus.Revoked) {
				throw new ConflictException('Already linked to this organization');
			}
			const revoked = await this.consents.revokeActive(
				consent.relationshipId,
				userId,
				new Date()
			);
			if (revoked) {
				await this.recordEnding(CONSENT_REVOKED_EVENT, userId, revoked);
			}
		}
	}

	/**
	 * Compensation of a failed grant in changeSharedPortfolios: if no ACTIVE
	 * consent is left, the relationship is revoked and the end audited. Best
	 * effort (ids-only log); the caller rethrows the grant error.
	 */
	private async closeIfUnconsented(
		userId: string,
		previous: Consent
	): Promise<void> {
		try {
			const active = await this.consents.findActiveByRelationship(
				previous.relationshipId
			);
			if (active) return;
			if (await this.revokeRelationship(previous.relationshipId)) {
				await this.recordEnding(CONSENT_REVOKED_EVENT, userId, previous);
			}
		} catch (error) {
			this.logFailure(
				'revoke unconsented relationship',
				previous.relationshipId,
				error
			);
		}
	}

	/** LGPD: ACTIVE relationships of the user's profiles, consent or not. */
	private async revokeOwnedRelationships(userId: string): Promise<number> {
		const profileIds = await this.profiles.listIdsByOwner(userId);
		const active =
			await this.relationshipStore.listActiveByClientProfiles(profileIds);
		let revoked = 0;
		for (const relationship of active) {
			if (!(await this.revokeRelationship(relationship.id))) continue;
			revoked += 1;
			await this.recordEnding(CONSENT_REVOKED_EVENT, userId, {
				orgId: relationship.orgId,
				clientProfileId: relationship.clientProfileId,
				relationshipId: relationship.id,
			});
		}
		return revoked;
	}

	/**
	 * Compensation of acceptInvite: best effort per step, ids-only logs. A
	 * grant that was already audited gets its matching revoke event.
	 */
	private async undoAccept(
		invite: ClientInvite,
		userId: string,
		consent: Consent | undefined,
		audited: boolean
	): Promise<void> {
		if (consent) {
			try {
				const revoked = await this.consents.revokeActive(
					invite.relationshipId,
					userId,
					new Date()
				);
				if (revoked && audited) {
					await this.recordEnding(CONSENT_REVOKED_EVENT, userId, revoked);
				}
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

	/** Payload carries counts only: no e-mail, name or portfolio id. */
	private async record(
		type: string,
		userId: string,
		scope: ConsentScope
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject: scope.clientProfileId,
			actorRef: actorRefOf(userId),
			occurredAt: new Date(),
			payload: {
				orgId: scope.orgId,
				portfolioCount: scope.portfolioCount,
				consentVersion: scope.consentVersion,
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

	/** No usable e-mail: those invites cannot be found, keep them (ids-only log). */
	private async deleteInvitesOf(
		userId: string,
		email: string | undefined
	): Promise<number> {
		const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
		if (!isValidEmail(normalized)) {
			this.logger.warn(
				`Erasure of user ${userId} without a known e-mail: e-mail invites kept`
			);
			return 0;
		}
		return this.invites.deleteByEmail(normalized);
	}

	/**
	 * E-mail aos assessores do cliente, depois que a ação do investidor já
	 * valeu. Não espera o envio e nunca muda o resultado: uma falha (síncrona
	 * ou não) registra só a classe do erro.
	 */
	private notifyAdvisors(
		target: { orgId: string; clientProfileId: string },
		kind: RelationshipUpdateKind
	): void {
		const failed = (error: unknown) =>
			this.logFailure(
				`notify advisors of ${kind} client`,
				target.clientProfileId,
				error
			);
		try {
			void this.notifier
				.notify({
					orgId: target.orgId,
					clientProfileId: target.clientProfileId,
					kind,
				})
				.catch(failed);
		} catch (error) {
			failed(error);
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

/** What a consent audit event may carry: ids of the link and counts only. */
interface ConsentScope {
	orgId: string;
	clientProfileId: string;
	portfolioCount: number;
	consentVersion: number;
}

function scopeOf(consent: Consent): ConsentScope {
	return {
		orgId: consent.orgId,
		clientProfileId: consent.clientProfileId,
		portfolioCount: consent.portfolioIds.length,
		consentVersion: consent.version,
	};
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
