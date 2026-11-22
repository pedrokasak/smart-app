import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { Membership } from '../domain/entities';
import { OrgRole } from '../domain/enums';
import { maskEmail } from '../domain/invite-rules';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_MEMBERSHIP_STORE,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import { OrganizationService } from './organization.service';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { MembershipStorePort } from './ports/membership.store.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from './ports/portal-account-directory.port';
import type { PortalAccountDirectoryPort } from './ports/portal-account-directory.port';
import {
	MemberNotFoundError,
	OwnerCannotBeRemovedError,
	OwnerCannotLeaveError,
} from './team-errors';

export const MEMBER_REMOVED_EVENT = 'advisor.member.removed';
export const MEMBER_LEFT_EVENT = 'advisor.member.left';
export const MEMBER_PROMOTED_EVENT = 'advisor.member.promoted';

const ASSIGNMENTS_PAGE = 200;

export interface TeamMember {
	userId: string;
	name: string;
	emailMasked: string;
	role: OrgRole;
	joinedAt: Date;
	isOwner: boolean;
}

/** O que o desfazer precisa para voltar ao estado anterior à saída. */
interface Snapshot {
	membership: Membership;
	clientProfileIds: string[];
}

/**
 * Equipe da organização: listar, promover, remover e sair. Remover não mexe
 * em clientes, relacionamentos nem convites; só no vínculo e nas atribuições
 * do membro. Auditoria só com ids; falha de auditoria desfaz a operação.
 */
@Injectable()
export class TeamService {
	private readonly logger = new Logger(TeamService.name);

	constructor(
		private readonly authz: AuthorizationService,
		private readonly orgs: OrganizationService,
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(ADVISOR_PORTAL_ACCOUNT_DIRECTORY)
		private readonly accounts: PortalAccountDirectoryPort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	/** Qualquer membro vê a equipe; e-mail só mascarado. */
	async listMembers(ctx: AccessContext): Promise<TeamMember[]> {
		await this.authz.ensureOrgMember(ctx);
		const [members, ownerId] = await Promise.all([
			this.memberships.listByOrg(ctx.orgId),
			this.orgs.ownerOf(ctx.orgId),
		]);
		const profiles = await this.accounts.findProfiles(
			members.map((m) => m.userId)
		);
		return members.map((member) => {
			const profile = profiles.get(member.userId);
			return {
				userId: member.userId,
				name: profile?.name ?? '',
				emailMasked: profile?.email ? maskEmail(profile.email) : '',
				role: member.role,
				joinedAt: member.createdAt,
				isOwner: member.userId === ownerId,
			};
		});
	}

	async removeMember(ctx: AccessContext, userId: string): Promise<void> {
		await this.authz.ensureOrgAdmin(ctx);
		if ((await this.orgs.ownerOf(ctx.orgId)) === userId) {
			throw new OwnerCannotBeRemovedError();
		}
		await this.exit(ctx, userId, MEMBER_REMOVED_EVENT);
	}

	async promote(
		ctx: AccessContext,
		userId: string
	): Promise<{ userId: string; role: OrgRole }> {
		await this.authz.ensureOrgAdmin(ctx);
		const current = await this.memberships.findByUserAndOrg(userId, ctx.orgId);
		if (!current) throw new MemberNotFoundError();
		if (current.role === OrgRole.OrgAdmin) {
			return { userId, role: OrgRole.OrgAdmin };
		}

		const promoted = await this.memberships.setRole(
			userId,
			ctx.orgId,
			OrgRole.OrgAdmin
		);
		if (!promoted) throw new MemberNotFoundError();
		try {
			await this.record(MEMBER_PROMOTED_EVENT, ctx, userId);
		} catch (error) {
			await this.attempt('revert the role of', userId, () =>
				this.memberships.setRole(userId, ctx.orgId, current.role)
			);
			throw error;
		}
		return { userId, role: OrgRole.OrgAdmin };
	}

	/** O membro sai por conta própria; o dono não pode. */
	async leave(ctx: AccessContext): Promise<void> {
		await this.authz.ensureOrgMember(ctx);
		if ((await this.orgs.ownerOf(ctx.orgId)) === ctx.userId) {
			throw new OwnerCannotLeaveError();
		}
		await this.exit(ctx, ctx.userId, MEMBER_LEFT_EVENT);
	}

	/**
	 * Apaga o vínculo (o `false` do delete é o 404: ninguém mudou nada), depois
	 * as atribuições, e audita. Qualquer falha depois do vínculo apagado o
	 * recria com o mesmo papel e data de entrada e devolve as atribuições
	 * (`assignedBy` passa a ser quem agiu: o store não lista a autoria
	 * original), e relança. Auditar antes registraria algo que não aconteceu.
	 */
	private async exit(
		ctx: AccessContext,
		userId: string,
		event: string
	): Promise<void> {
		const membership = await this.memberships.findByUserAndOrg(
			userId,
			ctx.orgId
		);
		if (!membership) throw new MemberNotFoundError();
		const snapshot: Snapshot = {
			membership,
			clientProfileIds: await this.assignedClientIds(ctx.orgId, userId),
		};

		if (!(await this.memberships.delete(userId, ctx.orgId))) {
			throw new MemberNotFoundError();
		}
		try {
			await this.assignments.deleteByUser(ctx.orgId, userId);
			await this.record(event, ctx, userId);
		} catch (error) {
			await this.restore(ctx, snapshot);
			throw error;
		}
	}

	private async assignedClientIds(
		orgId: string,
		userId: string
	): Promise<string[]> {
		const ids: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.assignments.listClientIdsByUser(orgId, userId, {
				cursor,
				limit: ASSIGNMENTS_PAGE,
			});
			ids.push(...page.ids);
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		return ids;
	}

	private async restore(
		ctx: AccessContext,
		{ membership, clientProfileIds }: Snapshot
	): Promise<void> {
		await this.attempt('restore the membership of', membership.userId, () =>
			this.memberships.create({
				userId: membership.userId,
				orgId: membership.orgId,
				role: membership.role,
				createdAt: membership.createdAt,
			})
		);
		for (const clientProfileId of clientProfileIds) {
			await this.attempt('restore an assignment of', membership.userId, () =>
				this.assignments.assign(
					membership.orgId,
					clientProfileId,
					membership.userId,
					ctx.userId
				)
			);
		}
	}

	private async record(
		type: string,
		ctx: AccessContext,
		userId: string
	): Promise<void> {
		await this.audit.record({
			eventId: randomUUID(),
			type,
			version: 1,
			subject: userId,
			actorRef: actorRefOf(ctx.userId),
			occurredAt: new Date(),
			payload: { orgId: ctx.orgId },
		});
	}

	/** Desfazer é best effort: o erro original é o que o chamador recebe. */
	private async attempt(
		step: string,
		userId: string,
		run: () => Promise<unknown>
	): Promise<void> {
		try {
			await run();
		} catch (error) {
			this.logger.error(
				`Failed to ${step} ${userId}: ${
					error instanceof Error ? error.name : 'unknown'
				}`
			);
		}
	}
}
