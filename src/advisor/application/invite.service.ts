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
	ADVISOR_ATTENTION_PURGE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_ORG_STORE,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { ClientAttentionPurgePort } from './ports/client-attention-purge.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ADVISOR_INVITE_NOTIFIER } from './ports/invite-notifier.port';
import type { InviteNotifierPort } from './ports/invite-notifier.port';
import type { InviteStorePort } from './ports/invite.store.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import { RelationshipService } from './relationship.service';

export const INVITE_CREATED_EVENT = 'advisor.invite.created';

const MAX_CLIENT_NAME_LENGTH = 120;

/** Ids criados por um `createInvite`, para o desfazimento. */
interface CreatedInvite {
	profileId: string;
	relationshipId?: string;
	assigned: boolean;
}

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
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
		@Inject(ADVISOR_ATTENTION_PURGE)
		private readonly attention: ClientAttentionPurgePort
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
		const created: CreatedInvite = { profileId: profile.id, assigned: false };
		try {
			const relationship = await this.relationships.createPending(
				ctx.orgId,
				profile.id
			);
			created.relationshipId = relationship.id;
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
			// Convite feito por ADVISOR: o cliente novo já nasce atribuído a ele.
			if (membership.role === OrgRole.Advisor) {
				created.assigned = true;
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
			return {
				inviteId: invite.id,
				clientProfileId: profile.id,
				expiresAt,
			};
		} catch (error) {
			await this.undoCreate(ctx, created);
			throw error;
		}
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
	 * Fail closed: desfaz por exclusão de verdade só o que esta mesma chamada
	 * criou (atribuição, convite, relação e perfil), para não sobrar cliente
	 * que ninguém vê nem convite apontando para perfil apagado. Cada passo é
	 * independente e best effort; o chamador relança o erro original. Logs só
	 * com ids (sem e-mail, nome ou token).
	 */
	private async undoCreate(
		ctx: AccessContext,
		created: CreatedInvite
	): Promise<void> {
		const { profileId, relationshipId } = created;
		if (created.assigned) {
			await this.attempt('unassign the creator of', profileId, () =>
				this.assignments.unassign(ctx.orgId, profileId, ctx.userId)
			);
		}
		if (relationshipId) {
			// A relação é nova: só o convite desta chamada aponta para ela.
			await this.attempt('delete the invite of', profileId, () =>
				this.invites.deleteByRelationshipIds([relationshipId])
			);
			await this.attempt('delete the relationship of', profileId, () =>
				this.relationships.deleteCreated(relationshipId)
			);
		}
		await this.attempt('purge attention of', profileId, () =>
			this.attention.purgeClient(ctx.orgId, profileId)
		);
		await this.attempt('delete', profileId, () =>
			this.profiles.deleteById(profileId)
		);
	}

	private async attempt(
		step: string,
		clientProfileId: string,
		run: () => Promise<unknown>
	): Promise<void> {
		try {
			await run();
		} catch (error) {
			this.logFailure(step, clientProfileId, error);
		}
	}

	private logFailure(
		step: string,
		clientProfileId: string,
		error: unknown
	): void {
		this.logger.error(
			`Failed to ${step} client ${clientProfileId} during compensation: ${
				error instanceof Error ? error.name : 'unknown'
			}`
		);
	}
}
