import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { maskEmail } from '../domain/invite-rules';
import { AdvisoryRelationship, ClientProfile } from '../domain/entities';
import { ProfileOrigin, RelationshipStatus } from '../domain/enums';
import {
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import { ClientNotAccessibleError } from './access-errors';
import { AuthorizationService } from './authorization.service';
import type { AccessContext } from './authorization.service';
import { ClientProfileService } from './client-profile.service';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { InviteStorePort } from './ports/invite.store.port';
import type { RelationshipStorePort } from './ports/relationship.store.port';
import { RelationshipService } from './relationship.service';

export type ClientListStatus = 'OPEN' | 'REVOKED';

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

const OPEN_STATUSES = [RelationshipStatus.Active, RelationshipStatus.Pending];
const REVOKED_STATUSES = [RelationshipStatus.Revoked];

/** Diretório de clientes da organização ativa (leitura e criação). */
@Injectable()
export class ClientDirectoryService {
	constructor(
		private readonly authz: AuthorizationService,
		private readonly clientProfiles: ClientProfileService,
		private readonly relationshipService: RelationshipService,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_INVITE_STORE) private readonly invites: InviteStorePort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async listClients(
		ctx: AccessContext,
		query: { status: ClientListStatus; cursor?: string; limit: number }
	): Promise<{ items: ClientSummary[]; nextCursor: string | null }> {
		await this.authz.ensureOrgMember(ctx);
		const page = await this.relationships.listByOrg(ctx.orgId, {
			statuses: query.status === 'OPEN' ? OPEN_STATUSES : REVOKED_STATUSES,
			cursor: query.cursor,
			limit: query.limit,
		});
		const found = await this.profiles.findByIds(
			ctx.orgId,
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
	 * Cria o cliente ADVISOR_CREATED e a relação ACTIVE. A auditoria vem
	 * depois: se ela falhar, o cliente e a relação ficam e o erro sobe.
	 */
	async createClient(
		ctx: AccessContext,
		input: { name: string }
	): Promise<ClientSummary> {
		await this.authz.ensureOrgMember(ctx);
		const profile = await this.clientProfiles.createByAdvisor(ctx.orgId, {
			name: input.name,
		});
		const relationship = await this.relationshipService.create(
			ctx.orgId,
			profile.id
		);
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
		await this.authz.ensureOrgMember(ctx);
		const pending = await this.invites.listPendingByOrg(ctx.orgId, new Date());
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
