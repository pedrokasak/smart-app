import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { planCapabilityDenied } from 'src/subscription/capabilities/plan-capability.guard';
import { accessContextOf } from './request-context';

/**
 * Porta do portal pela organização ativa (E2, E4): o escritório tem acesso se
 * o dono tem `advisor.portal` (plano ou liberação do admin); o membro herda.
 * Roda depois do `OrgContextGuard`, que preenche `req.orgContext`. Organização
 * sem dono, ou com dono sem acesso, dá o mesmo 403 `PLAN_CAPABILITY_REQUIRED`
 * do `AdvisorPortalGuard`.
 */
@Injectable()
export class OrgPortalGuard implements CanActivate {
	constructor(
		private readonly organizations: OrganizationService,
		private readonly portalAccess: PortalAccessService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const { orgId } = accessContextOf(context.switchToHttp().getRequest());
		const owner = await this.organizations.ownerOf(orgId);
		if (owner && (await this.portalAccess.hasAccess(owner))) return true;
		throw planCapabilityDenied('advisor.portal');
	}
}
