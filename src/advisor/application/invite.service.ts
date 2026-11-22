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
import {
	generateInviteToken,
	inviteExpiry,
	inviteUsability,
	isValidEmail,
	MAX_INVITE_RESENDS,
	normalizeEmail,
} from '../domain/invite-rules';
import { normalizeDisplayName } from '../domain/display-name';
import { InviteStatus, OrgRole, ProfileOrigin } from '../domain/enums';
import { ClientInvite } from '../domain/consent.entities';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_ORG_STORE,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ADVISOR_INVITE_NOTIFIER } from './ports/invite-notifier.port';
import type { InviteNotifierPort } from './ports/invite-notifier.port';
import type { InviteStorePort } from './ports/invite.store.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import { RelationshipService } from './relationship.service';

export const INVITE_CREATED_EVENT = 'advisor.invite.created';

const MAX_CLIENT_NAME_LENGTH = 120;

export class InvalidInviteError extends UnprocessableEntityException {
	constructor(reason: 'INVALID_EMAIL' | 'INVALID_NAME') {
		super({ reason });
	}
}

export class InviteConflictError extends ConflictException {
	constructor(reason: 'PENDING_INVITE' | 'RESEND_LIMIT' | 'NOT_PENDING') {
		super({ reason });
	}
}

@Injectable()
export class InviteService {
	private readonly logger = new Logger(InviteService.name);

	constructor(
		private readonly authz: AuthorizationService,
		private readonly relationships: RelationshipService,
		@Inject(ADVISOR_INVITE_STORE) private readonly invites: InviteStorePort,
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_INVITE_NOTIFIER)
		private readonly notifier: InviteNotifierPort,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async createInvite(
		ctx: AccessContext,
		input: { email: string; clientName: string }
	): Promise<{ inviteId: string; clientProfileId: string; expiresAt: Date }> {
		const membership = await this.authz.ensureOrgMember(ctx);

		const email = normalizeEmail(input.email ?? '');
		if (!isValidEmail(email)) throw new InvalidInviteError('INVALID_EMAIL');
		const clientName = normalizeDisplayName(input.clientName, {
			min: 1,
			max: MAX_CLIENT_NAME_LENGTH,
		});
		if (clientName === null) throw new InvalidInviteError('INVALID_NAME');

		await this.assertNoLivePendingInvite(ctx.orgId, email);
		const orgName = await this.orgNameOf(ctx.orgId);

		const profile = await this.profiles.create({
			orgId: ctx.orgId,
			name: clientName,
			origin: ProfileOrigin.ClientCreated,
		});
		const relationship = await this.relationships.createPending(
			ctx.orgId,
			profile.id
		);
		const { token, tokenHash } = generateInviteToken();
		const expiresAt = inviteExpiry(new Date());
		const invite = await this.invites.create({
			orgId: ctx.orgId,
			clientProfileId: profile.id,
			relationshipId: relationship.id,
			email,
			tokenHash,
			status: InviteStatus.Pending,
			expiresAt,
			resendCount: 0,
			invitedByUserId: ctx.userId,
		});

		let assigned = false;
		try {
			// Convite feito por ADVISOR: o cliente novo já nasce atribuído a ele.
			if (membership.role === OrgRole.Advisor) {
				assigned = true;
				await this.assignments.assign(
					ctx.orgId,
					profile.id,
					ctx.userId,
					ctx.userId
				);
			}
			// Fail closed: a failed audit blocks the grant path, nothing is sent.
			await this.audit.record({
				eventId: randomUUID(),
				type: INVITE_CREATED_EVENT,
				version: 1,
				subject: profile.id,
				actorRef: actorRefOf(ctx.userId),
				occurredAt: new Date(),
				payload: { orgId: ctx.orgId },
			});
			await this.notifier.sendInvite({
				to: email,
				token,
				orgName,
				expiresAt,
			});
		} catch (error) {
			if (assigned) await this.unassignCreator(ctx, profile.id, invite.id);
			await this.discard(invite.id, invite.relationshipId);
			throw error;
		}

		return {
			inviteId: invite.id,
			clientProfileId: profile.id,
			expiresAt,
		};
	}

	async resendInvite(
		ctx: AccessContext,
		inviteId: string
	): Promise<{ expiresAt: Date }> {
		const invite = await this.findInScope(ctx, inviteId);

		const { token, tokenHash } = generateInviteToken();
		const expiresAt = inviteExpiry(new Date());
		const rotated = await this.invites.rotateToken(
			invite.id,
			tokenHash,
			expiresAt,
			MAX_INVITE_RESENDS
		);
		if (!rotated) {
			const current = await this.invites.findById(ctx.orgId, inviteId);
			throw new InviteConflictError(
				current?.status === InviteStatus.Pending
					? 'RESEND_LIMIT'
					: 'NOT_PENDING'
			);
		}

		await this.notifier.sendInvite({
			to: rotated.email,
			token,
			orgName: await this.orgNameOf(ctx.orgId),
			expiresAt,
		});
		return { expiresAt };
	}

	async cancelInvite(ctx: AccessContext, inviteId: string): Promise<void> {
		const invite = await this.findInScope(ctx, inviteId);

		const cancelled = await this.invites.transition(
			invite.id,
			InviteStatus.Cancelled,
			new Date()
		);
		if (!cancelled) throw new InviteConflictError('NOT_PENDING');
		await this.relationships.revokePending(cancelled.relationshipId);
	}

	/**
	 * Convite da org de ctx cujo cliente está no alcance do membro. ADVISOR
	 * sobre cliente não atribuído recebe o mesmo 404 de convite inexistente.
	 */
	private async findInScope(
		ctx: AccessContext,
		inviteId: string
	): Promise<ClientInvite> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const invite = await this.invites.findById(ctx.orgId, inviteId);
		if (
			!invite ||
			!(await this.authz.isClientInScope(membership, invite.clientProfileId))
		) {
			throw new NotFoundException('Invite not found');
		}
		return invite;
	}

	/** A live PENDING invite blocks; expired ones are closed and ignored. */
	private async assertNoLivePendingInvite(
		orgId: string,
		email: string
	): Promise<void> {
		const pending = await this.invites.findPendingByOrgAndEmail(orgId, email);
		const now = new Date();
		const expired = pending.filter(
			(i) => inviteUsability(i, now) === 'EXPIRED'
		);
		if (expired.length < pending.length) {
			throw new InviteConflictError('PENDING_INVITE');
		}
		for (const invite of expired) {
			await this.invites.transition(invite.id, InviteStatus.Expired, now);
		}
	}

	private async orgNameOf(orgId: string): Promise<string> {
		const org = await this.orgs.findById(orgId);
		if (!org) throw new Error('Organization of the invite not found');
		return org.name;
	}

	/**
	 * Compensation for a failed audit or send: each step is independent and
	 * best effort, so one failing never skips the other. The caller rethrows
	 * the original error. Logs carry ids only (no e-mail, name or token).
	 */
	private async discard(
		inviteId: string,
		relationshipId: string
	): Promise<void> {
		try {
			await this.invites.transition(
				inviteId,
				InviteStatus.Cancelled,
				new Date()
			);
		} catch (error) {
			this.logFailure('cancel invite', inviteId, error);
		}
		try {
			await this.relationships.revokePending(relationshipId);
		} catch (error) {
			this.logFailure('revoke pending relationship of invite', inviteId, error);
		}
	}

	/** Best effort, como `discard`: a falha só vai para o log, com ids. */
	private async unassignCreator(
		ctx: AccessContext,
		clientProfileId: string,
		inviteId: string
	): Promise<void> {
		try {
			await this.assignments.unassign(ctx.orgId, clientProfileId, ctx.userId);
		} catch (error) {
			this.logFailure('unassign the creator of invite', inviteId, error);
		}
	}

	private logFailure(step: string, inviteId: string, error: unknown): void {
		this.logger.error(
			`Failed to ${step} ${inviteId} during compensation: ${
				error instanceof Error ? error.name : 'unknown'
			}`
		);
	}
}
