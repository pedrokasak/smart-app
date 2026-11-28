import { Module } from '@nestjs/common';
import { AdvisorModule } from 'src/advisor/advisor.module';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import { AlertSettingsController } from './alert-settings.controller';
import { AlertsController } from './alerts.controller';
import { ClientsController } from './clients.controller';
import { DashboardController } from './dashboard.controller';
import { InvitesController } from './invites.controller';
import { MeMemberInvitesController } from './me-member-invites.controller';
import { MeMembershipController } from './me-membership.controller';
import { MeOrganizationsController } from './me-organizations.controller';
import { MemberInvitesController } from './member-invites.controller';
import { MembersController } from './members.controller';
import { OrgPortalGuard } from './org-portal.guard';
import { OrganizationsController } from './organizations.controller';
import { WealthSummaryAssembler } from './wealth-summary.assembler';

/**
 * BFF do portal do assessor (`/advisor/v1`). Só traduz HTTP: toda regra vem
 * dos serviços exportados por `AdvisorModule`, que nunca importa este módulo.
 */
@Module({
	imports: [AdvisorModule],
	controllers: [
		OrganizationsController,
		MeOrganizationsController,
		ClientsController,
		InvitesController,
		MembersController,
		MeMembershipController,
		MemberInvitesController,
		MeMemberInvitesController,
		DashboardController,
		AlertsController,
		AlertSettingsController,
	],
	providers: [
		AdvisorPortalGuard,
		OrgPortalGuard,
		AdvisorBffExceptionFilter,
		WealthSummaryAssembler,
	],
})
export class AdvisorBffModule {}
