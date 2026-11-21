import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { requesterIdOf } from 'src/auth/ownership';
import { planCapabilityDenied } from 'src/subscription/capabilities/plan-capability.guard';

/**
 * Porta do portal do assessor (P3a, U4/U7): plano com `advisor.portal` ou
 * liberação ativa do admin. Roda depois do `JwtAuthGuard`; sem acesso, 403
 * `PLAN_CAPABILITY_REQUIRED`.
 */
@Injectable()
export class AdvisorPortalGuard implements CanActivate {
	constructor(private readonly portalAccess: PortalAccessService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest();
		const userId = requesterIdOf(req);
		if (await this.portalAccess.hasAccess(userId)) return true;
		throw planCapabilityDenied('advisor.portal');
	}
}
