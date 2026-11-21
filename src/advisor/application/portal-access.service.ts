import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
	SECURITY_AUDIT,
	SecurityAudit,
} from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import {
	planHasCapability,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import { maskEmail } from '../domain/invite-rules';
import { PortalGrantListItem } from '../domain/portal-access';
import { ADVISOR_PORTAL_GRANT_STORE } from './advisor.tokens';
import {
	ADVISOR_PORTAL_ACCOUNT_DIRECTORY,
	PortalAccountDirectoryPort,
} from './ports/portal-account-directory.port';
import { PortalGrantStorePort } from './ports/portal-grant.store.port';

/**
 * Quem entra no portal do assessor (P3a, U4, U6, U7): o plano tem
 * `advisor.portal` ou o admin liberou o usuário no piloto. A liberação fica
 * numa coleção própria e nunca toca a assinatura B2C.
 */
@Injectable()
export class PortalAccessService {
	private readonly logger = new Logger(PortalAccessService.name);

	constructor(
		@Inject(ADVISOR_PORTAL_GRANT_STORE)
		private readonly grants: PortalGrantStorePort,
		@Inject(ADVISOR_PORTAL_ACCOUNT_DIRECTORY)
		private readonly accounts: PortalAccountDirectoryPort,
		@Inject(USER_PLAN_RESOLVER)
		private readonly plans: UserPlanResolverPort,
		@Inject(SECURITY_AUDIT)
		private readonly securityAudit: SecurityAudit
	) {}

	async hasAccess(userId: string): Promise<boolean> {
		if (await this.planOpensPortal(userId)) return true;
		return (await this.grants.findActive(userId)) !== null;
	}

	async grantByEmail(
		adminId: string,
		email: string
	): Promise<{ userId: string }> {
		const userId = await this.accounts.findUserIdByEmail(
			email.trim().toLowerCase()
		);
		if (!userId) throw new NotFoundException('Usuário não encontrado');

		const grant = await this.grants.grant(userId, adminId, new Date());
		this.securityAudit.emit({
			type: SECURITY_EVENT.AdvisorPortalGranted,
			actor: { userId: adminId },
			subject: { userId },
			payload: { grantId: grant.id },
		});
		return { userId };
	}

	async revoke(adminId: string, userId: string): Promise<void> {
		const revoked = await this.grants.revoke(userId, new Date());
		if (!revoked) {
			throw new NotFoundException('Liberação ativa não encontrada');
		}
		this.securityAudit.emit({
			type: SECURITY_EVENT.AdvisorPortalRevoked,
			actor: { userId: adminId },
			subject: { userId },
		});
	}

	async listGrants(): Promise<PortalGrantListItem[]> {
		const active = await this.grants.listActive();
		const emails = await this.accounts.findEmails(active.map((g) => g.userId));
		return active.map((g) => {
			const email = emails.get(g.userId);
			return {
				userId: g.userId,
				emailMasked: email ? maskEmail(email) : null,
				grantedAt: g.grantedAt,
			};
		});
	}

	/** Falha ao ler o plano conta como sem plano, nunca como acesso. */
	private async planOpensPortal(userId: string): Promise<boolean> {
		try {
			const access = await this.plans.resolveWithCapabilities(userId);
			return planHasCapability(
				access.capabilities,
				'advisor.portal',
				access.tier,
				access.capabilitiesKnown
			);
		} catch (error) {
			this.logger.warn(
				`Plano não lido ao conferir o portal do assessor: ${(error as Error)?.message ?? error}`
			);
			return false;
		}
	}
}
