import {
	ConflictException,
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import type { AuditTrail } from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { Organization } from '../domain/entities';
import { normalizeDisplayName } from '../domain/display-name';
import { AdvisorType, OrgRole } from '../domain/enums';
import { ADVISOR_ORG_STORE } from './advisor.tokens';
import { MembershipService } from './membership.service';
import { ADVISOR_INVITEE_IDENTITY } from './ports/invitee-identity.port';
import type { InviteeIdentityPort } from './ports/invitee-identity.port';
import type { OrganizationStorePort } from './ports/organization.store.port';
import { DuplicateOrganizationOwnerError } from './ports/store-errors';

export interface CreateOrganizationInput {
	name: string;
	advisorType: AdvisorType;
	plan?: string;
}

export interface OrganizationSummary {
	id: string;
	name: string;
	advisorType: AdvisorType;
	role: OrgRole;
	/** Dono da organização; null em linha legada sem `ownerUserId`. */
	ownerUserId: string | null;
}

export type OrganizationRuleReason =
	| 'EMAIL_NOT_VERIFIED'
	| 'INVALID_NAME'
	| 'INVALID_ADVISOR_TYPE';

/**
 * Regra de criação da organização violada; `reason` é o motivo estável.
 * E-mail não confirmado é 403; nome e tipo inválidos são 400.
 */
export class OrganizationRuleError extends HttpException {
	readonly reason: OrganizationRuleReason;

	constructor(reason: OrganizationRuleReason) {
		super(
			reason,
			reason === 'EMAIL_NOT_VERIFIED'
				? HttpStatus.FORBIDDEN
				: HttpStatus.BAD_REQUEST
		);
		this.reason = reason;
	}
}

export class AlreadyOwnsOrganizationError extends ConflictException {
	readonly reason = 'ALREADY_OWNS_ORGANIZATION' as const;

	constructor() {
		super('ALREADY_OWNS_ORGANIZATION');
	}
}

export const ORGANIZATION_CREATED_EVENT = 'advisor.organization.created';

const NAME_MIN = 2;
const NAME_MAX = 120;

@Injectable()
export class OrganizationService {
	private readonly logger = new Logger(OrganizationService.name);

	constructor(
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		private readonly memberships: MembershipService,
		@Inject(ADVISOR_INVITEE_IDENTITY)
		private readonly identity: InviteeIdentityPort,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	create(input: CreateOrganizationInput): Promise<Organization> {
		return this.orgs.create({
			name: input.name,
			advisorType: input.advisorType,
			plan: input.plan,
		});
	}

	/**
	 * Cria a organização do usuário (uma por dono) e a membership ORG_ADMIN.
	 * Sem a membership não há organização: qualquer falha depois de criar a
	 * org a apaga e relança o erro. A auditoria vem antes da membership para
	 * que uma falha dela também se resolva só apagando a org (não há `delete`
	 * de membership).
	 */
	async createForOwner(
		userId: string,
		input: { name: string; advisorType: AdvisorType }
	): Promise<Organization> {
		if (typeof userId !== 'string' || userId.trim() === '') {
			throw new Error('userId is required to create an organization');
		}
		const account = await this.identity.find(userId);
		if (!account?.emailVerified) {
			throw new OrganizationRuleError('EMAIL_NOT_VERIFIED');
		}
		const name = this.validName(input.name);
		if (!Object.values(AdvisorType).includes(input.advisorType)) {
			throw new OrganizationRuleError('INVALID_ADVISOR_TYPE');
		}

		let org: Organization;
		try {
			org = await this.orgs.create({
				name,
				advisorType: input.advisorType,
				ownerUserId: userId,
			});
		} catch (error) {
			if (error instanceof DuplicateOrganizationOwnerError) {
				throw new AlreadyOwnsOrganizationError();
			}
			throw error;
		}

		try {
			await this.audit.record({
				eventId: randomUUID(),
				type: ORGANIZATION_CREATED_EVENT,
				version: 1,
				subject: org.id,
				actorRef: actorRefOf(userId),
				occurredAt: new Date(),
				payload: { orgId: org.id },
			});
			await this.memberships.add(userId, org.id, OrgRole.OrgAdmin);
		} catch (error) {
			await this.compensate(org.id);
			throw error;
		}
		return org;
	}

	async listForUser(userId: string): Promise<OrganizationSummary[]> {
		const memberships = await this.memberships.listForUser(userId);
		const summaries = await Promise.all(
			memberships.map(async (membership) => {
				const org = await this.orgs.findById(membership.orgId);
				return org
					? {
							id: org.id,
							name: org.name,
							advisorType: org.advisorType,
							role: membership.role,
							ownerUserId: org.ownerUserId ?? null,
						}
					: null;
			})
		);
		return summaries.filter((s): s is OrganizationSummary => s !== null);
	}

	/** Dono da organização; null se ela não existe ou não tem dono (legado). */
	async ownerOf(orgId: string): Promise<string | null> {
		const org = await this.orgs.findById(orgId);
		return org?.ownerUserId ?? null;
	}

	private validName(raw: unknown): string {
		const name = normalizeDisplayName(raw, { min: NAME_MIN, max: NAME_MAX });
		if (name === null) throw new OrganizationRuleError('INVALID_NAME');
		return name;
	}

	private async compensate(orgId: string): Promise<void> {
		try {
			await this.orgs.delete(orgId);
		} catch (error) {
			// O erro original é o que importa para o chamador; a org órfã fica no log.
			this.logger.error(
				`Failed to delete organization ${orgId} after a failed creation`,
				error instanceof Error ? error.stack : undefined
			);
		}
	}
}
