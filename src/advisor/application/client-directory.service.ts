import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { normalizeDisplayName } from '../domain/display-name';
import { maskEmail } from '../domain/invite-rules';
import { AdvisoryRelationship, ClientProfile } from '../domain/entities';
import { OrgRole, ProfileOrigin, RelationshipStatus } from '../domain/enums';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_ATTENTION_PURGE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import {
	AssigneeFilterForbiddenError,
	ClientNotAccessibleError,
} from './access-errors';
import { OrganizationRuleError } from './organization.service';
import { AuthorizationService } from './authorization.service';
import type { AccessContext } from './authorization.service';
import { ClientProfileService } from './client-profile.service';
import type { AssignmentStorePort } from './ports/assignment.store.port';
import type { ClientAttentionPurgePort } from './ports/client-attention-purge.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { InviteStorePort } from './ports/invite.store.port';
import type {
	RelationshipPage,
	RelationshipStorePort,
} from './ports/relationship.store.port';
import { RelationshipService } from './relationship.service';

export type ClientListStatus = 'OPEN' | 'REVOKED';

/** `me`, `none` (sem assessor) ou o userId de um membro. */
export type ClientAssigneeFilter = 'me' | 'none' | string;

export interface ListClientsQuery {
	status: ClientListStatus;
	/** Só para ORG_ADMIN; o ADVISOR já recebe a lista dos atribuídos a ele. */
	assignee?: ClientAssigneeFilter;
	cursor?: string;
	limit: number;
}

export interface ClientSummary {
	id: string;
	name: string;
	origin: ProfileOrigin;
	relationshipStatus: RelationshipStatus;
	hasSharedPortfolios: boolean;
}

export interface PendingInviteSummary {
	id: string;
	clientProfileId: string;
	clientName: string;
	invitedEmailMasked: string;
	expiresAt: Date;
	resendCount: number;
}

export const CLIENT_CREATED_EVENT = 'advisor.client.created';

const CLIENT_NAME_MAX = 120;
const OPEN_STATUSES = [RelationshipStatus.Active, RelationshipStatus.Pending];
const REVOKED_STATUSES = [RelationshipStatus.Revoked];

/** Diretório de clientes da organização ativa (leitura e criação). */
@Injectable()
export class ClientDirectoryService {
	private readonly logger = new Logger(ClientDirectoryService.name);

	constructor(
		private readonly authz: AuthorizationService,
		private readonly clientProfiles: ClientProfileService,
		private readonly relationshipService: RelationshipService,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_INVITE_STORE) private readonly invites: InviteStorePort,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
		@Inject(ADVISOR_ATTENTION_PURGE)
		private readonly attention: ClientAttentionPurgePort
	) {}

	/**
	 * ADVISOR: só os clientes atribuídos a ele (paginado pelas atribuições) e
	 * sem filtro de assessor. ORG_ADMIN: todos, ou filtrados por `assignee`.
	 */
	async listClients(
		ctx: AccessContext,
		query: ListClientsQuery
	): Promise<{ items: ClientSummary[]; nextCursor: string | null }> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const statuses = query.status === 'OPEN' ? OPEN_STATUSES : REVOKED_STATUSES;
		if (membership.role !== OrgRole.OrgAdmin) {
			if (query.assignee !== undefined) {
				throw new AssigneeFilterForbiddenError();
			}
			return this.listAssignedTo(ctx.orgId, ctx.userId, statuses, query);
		}
		if (query.assignee === undefined) {
			return this.fromRelationshipPage(
				ctx.orgId,
				await this.relationships.listByOrg(ctx.orgId, {
					statuses,
					cursor: query.cursor,
					limit: query.limit,
				})
			);
		}
		if (query.assignee === 'none') {
			return this.fromRelationshipPage(
				ctx.orgId,
				await this.relationships.listUnassignedByOrg(ctx.orgId, {
					statuses,
					cursor: query.cursor,
					limit: query.limit,
				})
			);
		}
		const userId = query.assignee === 'me' ? ctx.userId : query.assignee;
		return this.listAssignedTo(ctx.orgId, userId, statuses, query);
	}

	/**
	 * Cria o cliente ADVISOR_CREATED e a relação ACTIVE; feito por um ADVISOR,
	 * o cliente já nasce atribuído a ele. Fail closed: se a relação, a
	 * atribuição ou a auditoria falhar, o que esta operação criou é apagado
	 * (atribuição, relação e perfil) e o erro sobe.
	 */
	async createClient(
		ctx: AccessContext,
		input: { name: string }
	): Promise<ClientSummary> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const name = normalizeDisplayName(input.name, {
			min: 1,
			max: CLIENT_NAME_MAX,
		});
		if (name === null) throw new OrganizationRuleError('INVALID_NAME');
		const profile = await this.clientProfiles.createByAdvisor(ctx.orgId, {
			name,
		});
		let relationship: AdvisoryRelationship | undefined;
		let assigned = false;
		try {
			relationship = await this.relationshipService.create(
				ctx.orgId,
				profile.id
			);
			if (membership.role === OrgRole.Advisor) {
				assigned = true;
				await this.assignments.assign(
					ctx.orgId,
					profile.id,
					ctx.userId,
					ctx.userId
				);
			}
			await this.audit.record({
				eventId: randomUUID(),
				type: CLIENT_CREATED_EVENT,
				version: 1,
				subject: profile.id,
				actorRef: actorRefOf(ctx.userId),
				occurredAt: new Date(),
				payload: { orgId: ctx.orgId, clientProfileId: profile.id },
			});
			return this.summary(profile, relationship);
		} catch (error) {
			await this.undoCreate(ctx, profile.id, relationship?.id, assigned);
			throw error;
		}
	}

	async getClient(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<ClientSummary> {
		await this.authz.ensureOrgMember(ctx);
		await this.authz.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		const [profile, relationship] = await Promise.all([
			this.profiles.findById(clientProfileId),
			this.relationships.findByOrgAndClient(ctx.orgId, clientProfileId),
		]);
		if (!profile || !relationship) {
			// ensureCanAccessClient já exigiu os dois; só uma corrida chega aqui.
			throw new ClientNotAccessibleError();
		}
		return this.summary(profile, relationship);
	}

	async listPendingInvites(
		ctx: AccessContext
	): Promise<PendingInviteSummary[]> {
		const membership = await this.authz.ensureOrgMember(ctx);
		const all = await this.invites.listPendingByOrg(ctx.orgId, new Date());
		const inScope = await Promise.all(
			all.map((i) => this.authz.isClientInScope(membership, i.clientProfileId))
		);
		const pending = all.filter((_, index) => inScope[index]);
		const profiles = await this.profiles.findByIds(
			ctx.orgId,
			pending.map((i) => i.clientProfileId)
		);
		const byId = new Map(profiles.map((p) => [p.id, p]));
		return pending.map((invite) => ({
			id: invite.id,
			clientProfileId: invite.clientProfileId,
			clientName: byId.get(invite.clientProfileId)?.name ?? '',
			invitedEmailMasked: maskEmail(invite.email),
			expiresAt: invite.expiresAt,
			resendCount: invite.resendCount,
		}));
	}

	/**
	 * Página pelas atribuições do usuário: só os ids da página de atribuições
	 * são consumidos, então o cursor segue o das atribuições. Relações fora do
	 * status pedido (ou de perfil sem relação) ficam de fora e a busca continua
	 * até encher `limit` ou acabar, para não devolver página vazia no meio.
	 */
	private async listAssignedTo(
		orgId: string,
		userId: string,
		statuses: RelationshipStatus[],
		query: { cursor?: string; limit: number }
	): Promise<{ items: ClientSummary[]; nextCursor: string | null }> {
		const items: ClientSummary[] = [];
		let cursor = query.cursor;
		let nextCursor: string | null;
		do {
			const page = await this.assignments.listClientIdsByUser(orgId, userId, {
				cursor,
				limit: query.limit - items.length,
			});
			const [found, relationships] = await Promise.all([
				this.profiles.findByIds(orgId, page.ids),
				Promise.all(
					page.ids.map((id) => this.relationships.findByOrgAndClient(orgId, id))
				),
			]);
			const byId = new Map(found.map((p) => [p.id, p]));
			for (const relationship of relationships) {
				if (!relationship || !statuses.includes(relationship.status)) continue;
				const profile = byId.get(relationship.clientProfileId);
				if (profile) items.push(this.summary(profile, relationship));
			}
			nextCursor = page.nextCursor;
			cursor = nextCursor ?? undefined;
		} while (nextCursor !== null && items.length < query.limit);
		return { items, nextCursor };
	}

	private async fromRelationshipPage(
		orgId: string,
		page: RelationshipPage
	): Promise<{ items: ClientSummary[]; nextCursor: string | null }> {
		const found = await this.profiles.findByIds(
			orgId,
			page.items.map((r) => r.clientProfileId)
		);
		const byId = new Map(found.map((p) => [p.id, p]));
		const items: ClientSummary[] = [];
		for (const relationship of page.items) {
			const profile = byId.get(relationship.clientProfileId);
			if (profile) items.push(this.summary(profile, relationship));
		}
		return { items, nextCursor: page.nextCursor };
	}

	/**
	 * Desfaz a criação: só os ids que esta mesma operação criou. Cada passo é
	 * independente e best effort; o chamador relança o erro original. Logs só
	 * com ids.
	 */
	private async undoCreate(
		ctx: AccessContext,
		clientProfileId: string,
		relationshipId: string | undefined,
		assigned: boolean
	): Promise<void> {
		if (assigned) {
			await this.attempt('unassign', clientProfileId, () =>
				this.assignments.unassign(ctx.orgId, clientProfileId, ctx.userId)
			);
		}
		if (relationshipId) {
			await this.attempt('delete relationship of', clientProfileId, () =>
				this.relationships.deleteById(relationshipId)
			);
		}
		await this.attempt('purge attention of', clientProfileId, () =>
			this.attention.purgeClient(ctx.orgId, clientProfileId)
		);
		await this.attempt('delete profile', clientProfileId, () =>
			this.profiles.deleteById(clientProfileId)
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
			this.logger.error(
				`Failed to ${step} client ${clientProfileId} during compensation: ${
					error instanceof Error ? error.name : 'unknown'
				}`
			);
		}
	}

	private summary(
		profile: ClientProfile,
		relationship: AdvisoryRelationship
	): ClientSummary {
		return {
			id: profile.id,
			name: profile.name,
			origin: profile.origin,
			relationshipStatus: relationship.status,
			hasSharedPortfolios:
				relationship.status === RelationshipStatus.Active &&
				!!relationship.consentId,
		};
	}
}
