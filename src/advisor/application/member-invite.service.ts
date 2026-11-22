import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { AdvisorType, MemberInviteStatus, OrgRole } from '../domain/enums';
import {
	emailMatches,
	generateInviteToken,
	hashInviteToken,
	inviteExpiry,
	isValidEmail,
	maskEmail,
	MAX_INVITE_RESENDS,
	normalizeEmail,
} from '../domain/invite-rules';
import { memberInviteUsability } from '../domain/team-rules';
import { MemberInvite } from '../domain/team.entities';
import {
	ADVISOR_MEMBER_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import { InvalidInviteError } from './invite.service';
import {
	MemberInviteConflictError,
	MemberInviteNotFoundError,
} from './member-invite-errors';
import { ADVISOR_INVITEE_IDENTITY } from './ports/invitee-identity.port';
import type { InviteeIdentityPort } from './ports/invitee-identity.port';
import { ADVISOR_MEMBER_INVITE_NOTIFIER } from './ports/member-invite-notifier.port';
import type { MemberInviteNotifierPort } from './ports/member-invite-notifier.port';
import type { MemberInviteStorePort } from './ports/member-invite.store.port';
import type { MembershipStorePort } from './ports/membership.store.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from './ports/portal-account-directory.port';
import type { PortalAccountDirectoryPort } from './ports/portal-account-directory.port';
import {
	DuplicateMembershipError,
	DuplicatePendingMemberInviteError,
} from './ports/store-errors';

export const MEMBER_INVITED_EVENT = 'advisor.member.invited';
export const MEMBER_JOINED_EVENT = 'advisor.member.joined';
export const MEMBER_DECLINED_EVENT = 'advisor.member.declined';

/**
 * `findPendingByOrgAndEmail` só devolve o PENDING com `expiresAt > now`.
 * Perguntado com a época, devolve o PENDING que ocupa o índice único
 * (orgId, email), vencido ou não.
 */
const ANY_EXPIRY = new Date(0);

export interface PendingMemberInvite {
	id: string;
	emailMasked: string;
	expiresAt: Date;
	resendCount: number;
	invitedBy: string;
}

export interface MemberInvitePreview {
	organizationName: string;
	advisorType: AdvisorType;
	invitedEmailMasked: string;
	expiresAt: Date;
}

/**
 * Convite de membro (ADVISOR) para o escritório. Mesmo mecanismo do convite
 * de cliente: link por e-mail, 7 dias, até 3 reenvios, só o hash do token
 * guardado e o token prova o e-mail no aceite. Logs e auditoria só com ids.
 */
@Injectable()
export class MemberInviteService {
	private readonly logger = new Logger(MemberInviteService.name);

	constructor(
		private readonly authz: AuthorizationService,
		@Inject(ADVISOR_MEMBER_INVITE_STORE)
		private readonly invites: MemberInviteStorePort,
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort,
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		@Inject(ADVISOR_PORTAL_ACCOUNT_DIRECTORY)
		private readonly accounts: PortalAccountDirectoryPort,
		@Inject(ADVISOR_INVITEE_IDENTITY)
		private readonly identity: InviteeIdentityPort,
		@Inject(ADVISOR_MEMBER_INVITE_NOTIFIER)
		private readonly notifier: MemberInviteNotifierPort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async createInvite(
		ctx: AccessContext,
		input: { email: string }
	): Promise<{ inviteId: string; expiresAt: Date }> {
		await this.authz.ensureOrgAdmin(ctx);
		const email = normalizeEmail(
			typeof input?.email === 'string' ? input.email : ''
		);
		if (!isValidEmail(email)) throw new InvalidInviteError('INVALID_EMAIL');

		await this.assertNotMember(ctx.orgId, email);
		await this.closeExpiredOrConflict(ctx.orgId, email);
		const orgName = await this.orgNameOf(ctx.orgId);

		const { token, tokenHash } = generateInviteToken();
		const expiresAt = inviteExpiry(new Date());
		const invite = await this.createPending({
			orgId: ctx.orgId,
			email,
			role: OrgRole.Advisor,
			tokenHash,
			status: MemberInviteStatus.Pending,
			expiresAt,
			resendCount: 0,
			invitedByUserId: ctx.userId,
		});
		try {
			// Fail closed: sem o registro de auditoria nenhum e-mail sai.
			await this.record(MEMBER_INVITED_EVENT, ctx.userId, invite);
			await this.notifier.sendMemberInvite({
				to: email,
				token,
				orgName,
				expiresAt,
			});
		} catch (error) {
			await this.attempt('delete', invite.id, () =>
				this.invites.deleteById(invite.id)
			);
			throw error;
		}
		return { inviteId: invite.id, expiresAt };
	}

	async listPending(ctx: AccessContext): Promise<PendingMemberInvite[]> {
		await this.authz.ensureOrgAdmin(ctx);
		const pending = await this.invites.listPendingByOrg(ctx.orgId, new Date());
		return pending.map((invite) => ({
			id: invite.id,
			emailMasked: maskEmail(invite.email),
			expiresAt: invite.expiresAt,
			resendCount: invite.resendCount,
			invitedBy: invite.invitedByUserId,
		}));
	}

	/**
	 * Mesma regra do reenvio do convite de cliente: vale para qualquer PENDING
	 * abaixo do limite, inclusive o vencido, que ganha token e prazo novos.
	 * O limite fica no filtro atômico do store; a releitura só diz por que a
	 * troca não aconteceu.
	 */
	async resend(
		ctx: AccessContext,
		inviteId: string
	): Promise<{ expiresAt: Date }> {
		const invite = await this.findInOrg(ctx, inviteId);

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
			throw new MemberInviteConflictError(
				current?.status === MemberInviteStatus.Pending
					? 'RESEND_LIMIT'
					: 'NOT_PENDING'
			);
		}

		await this.notifier.sendMemberInvite({
			to: rotated.email,
			token,
			orgName: await this.orgNameOf(ctx.orgId),
			expiresAt,
		});
		return { expiresAt };
	}

	async cancel(ctx: AccessContext, inviteId: string): Promise<void> {
		const invite = await this.findInOrg(ctx, inviteId);
		const cancelled = await this.invites.transition(
			invite.id,
			MemberInviteStatus.Pending,
			MemberInviteStatus.Cancelled,
			new Date()
		);
		if (!cancelled) throw new MemberInviteConflictError('NOT_PENDING');
	}

	async preview(userId: string, token: string): Promise<MemberInvitePreview> {
		const { invite } = await this.openInvite(userId, token);
		const org = await this.orgs.findById(invite.orgId);
		if (!org) throw new MemberInviteNotFoundError();
		return {
			organizationName: org.name,
			advisorType: org.advisorType,
			invitedEmailMasked: maskEmail(invite.email),
			expiresAt: invite.expiresAt,
		};
	}

	/**
	 * A transição PENDING -> ACCEPTED é o portão de uso único; o índice único
	 * de membership é o segundo. Qualquer falha depois da transição desfaz a
	 * membership criada aqui e devolve o convite a PENDING. O e-mail só é
	 * confirmado com o aceite completo.
	 */
	async accept(
		userId: string,
		token: string
	): Promise<{ orgId: string; role: OrgRole }> {
		const { invite, accountEmail } = await this.openInvite(userId, token);
		if (await this.memberships.findByUserAndOrg(userId, invite.orgId)) {
			throw new MemberInviteConflictError('ALREADY_MEMBER');
		}

		const accepted = await this.invites.transition(
			invite.id,
			MemberInviteStatus.Pending,
			MemberInviteStatus.Accepted,
			new Date()
		);
		if (!accepted) throw new MemberInviteNotFoundError();

		let joined = false;
		try {
			await this.memberships.create({
				userId,
				orgId: accepted.orgId,
				role: accepted.role,
			});
			joined = true;
			await this.record(MEMBER_JOINED_EVENT, userId, accepted);
		} catch (error) {
			if (joined) {
				await this.attempt('remove the membership of', accepted.id, () =>
					this.memberships.delete(userId, accepted.orgId)
				);
			}
			await this.reopen(accepted.id, MemberInviteStatus.Accepted);
			if (error instanceof DuplicateMembershipError) {
				throw new MemberInviteConflictError('ALREADY_MEMBER');
			}
			throw error;
		}
		await this.proveInviteeEmail(userId, accountEmail);
		return { orgId: accepted.orgId, role: accepted.role };
	}

	/** Fail closed: sem auditoria a recusa não vale e o convite volta a PENDING. */
	async decline(userId: string, token: string): Promise<void> {
		const { invite } = await this.openInvite(userId, token);
		const declined = await this.invites.transition(
			invite.id,
			MemberInviteStatus.Pending,
			MemberInviteStatus.Declined,
			new Date()
		);
		if (!declined) throw new MemberInviteNotFoundError();
		try {
			await this.record(MEMBER_DECLINED_EVENT, userId, declined);
		} catch (error) {
			await this.reopen(declined.id, MemberInviteStatus.Declined);
			throw error;
		}
	}

	/**
	 * Convite PENDING, no prazo, enviado ao e-mail da conta de `userId`. Toda
	 * falha é o mesmo 404; o PENDING vencido encontrado aqui vira EXPIRED.
	 */
	private async openInvite(
		userId: string,
		token: string
	): Promise<{ invite: MemberInvite; accountEmail: string }> {
		if (typeof token !== 'string' || token.length === 0) {
			throw new MemberInviteNotFoundError();
		}
		const invite = await this.invites.findByTokenHash(hashInviteToken(token));
		if (!invite) throw new MemberInviteNotFoundError();

		const now = new Date();
		const usability = memberInviteUsability(invite, now);
		if (usability === 'EXPIRED') await this.expire(invite.id, now);
		if (usability !== 'OK') throw new MemberInviteNotFoundError();

		const account = await this.identity.find(userId);
		if (
			!account ||
			typeof account.email !== 'string' ||
			!emailMatches(invite, account.email)
		) {
			throw new MemberInviteNotFoundError();
		}
		return { invite, accountEmail: account.email };
	}

	/**
	 * A resposta não muda entre e-mail sem conta e conta fora da org: as duas
	 * consultas rodam sempre, e só um membro de verdade dá ALREADY_MEMBER.
	 */
	private async assertNotMember(orgId: string, email: string): Promise<void> {
		const userId = await this.accounts.findUserIdByEmail(email);
		const membership = await this.memberships.findByUserAndOrg(
			userId ?? '',
			orgId
		);
		if (userId && membership) {
			throw new MemberInviteConflictError('ALREADY_MEMBER');
		}
	}

	/**
	 * O PENDING no prazo bloqueia; o vencido ainda segura o índice único e é
	 * fechado como EXPIRED antes do convite novo.
	 */
	private async closeExpiredOrConflict(
		orgId: string,
		email: string
	): Promise<void> {
		const pending = await this.invites.findPendingByOrgAndEmail(
			orgId,
			email,
			ANY_EXPIRY
		);
		if (!pending) return;
		const now = new Date();
		if (memberInviteUsability(pending, now) !== 'EXPIRED') {
			throw new MemberInviteConflictError('PENDING_INVITE');
		}
		await this.expire(pending.id, now);
	}

	private async createPending(
		invite: Omit<MemberInvite, 'id' | 'createdAt'>
	): Promise<MemberInvite> {
		try {
			return await this.invites.create(invite);
		} catch (error) {
			if (error instanceof DuplicatePendingMemberInviteError) {
				throw new MemberInviteConflictError('PENDING_INVITE');
			}
			throw error;
		}
	}

	/** Convite da org de ctx, só para ORG_ADMIN; de outra org é 404. */
	private async findInOrg(
		ctx: AccessContext,
		inviteId: string
	): Promise<MemberInvite> {
		await this.authz.ensureOrgAdmin(ctx);
		const invite = await this.invites.findById(ctx.orgId, inviteId);
		if (!invite) throw new MemberInviteNotFoundError();
		return invite;
	}

	private async orgNameOf(orgId: string): Promise<string> {
		const org = await this.orgs.findById(orgId);
		if (!org) throw new Error('Organization of the member invite not found');
		return org.name;
	}

	private async expire(inviteId: string, at: Date): Promise<void> {
		await this.invites.transition(
			inviteId,
			MemberInviteStatus.Pending,
			MemberInviteStatus.Expired,
			at
		);
	}

	/** Desfaz uma resposta ao convite; best effort, o chamador relança. */
	private async reopen(
		inviteId: string,
		from: MemberInviteStatus
	): Promise<void> {
		await this.attempt('reopen', inviteId, () =>
			this.invites.transition(
				inviteId,
				from,
				MemberInviteStatus.Pending,
				new Date()
			)
		);
	}

	/**
	 * O token foi só para este endereço: o aceite prova que a pessoa o lê.
	 * Usa o e-mail como está na conta (o port só confirma se ainda for ele).
	 * Best effort: o aceite já está completo; a falha só vai para o log.
	 */
	private async proveInviteeEmail(
		userId: string,
		accountEmail: string
	): Promise<void> {
		try {
			await this.identity.markEmailVerified(userId, accountEmail);
		} catch (error) {
			this.logFailure('mark e-mail verified of user', userId, error);
		}
	}

	private async record(
		type: string,
		userId: string,
		invite: MemberInvite
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject: invite.id,
			actorRef: actorRefOf(userId),
			occurredAt: new Date(),
			payload: { orgId: invite.orgId },
		});
	}

	private async attempt(
		step: string,
		inviteId: string,
		run: () => Promise<unknown>
	): Promise<void> {
		try {
			await run();
		} catch (error) {
			this.logFailure(`${step} member invite`, inviteId, error);
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
