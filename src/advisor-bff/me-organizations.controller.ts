import {
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Req,
	UseFilters,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { requesterIdOf } from 'src/auth/ownership';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { ApiBffCommonResponses } from './api-bff-responses';
import { MyOrganizationResponseDto } from './dto/organization.dto';

/**
 * Organizações do usuário logado. Só JWT, sem guard de portal: o membro sem
 * plano precisa ver o escritório dele, e `portalActive` diz se o dono ainda
 * tem acesso (E2, E4).
 */
@Controller('advisor/v1')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class MeOrganizationsController {
	constructor(
		private readonly organizations: OrganizationService,
		private readonly portalAccess: PortalAccessService
	) {}

	@Get('me/organizations')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Lista as organizações do usuário' })
	@ApiResponse({ status: 200, type: [MyOrganizationResponseDto] })
	async listMine(@Req() req: any): Promise<MyOrganizationResponseDto[]> {
		const orgs = await this.organizations.listForUser(requesterIdOf(req));
		const owners = [
			...new Set(orgs.map((o) => o.ownerUserId).filter((o) => o !== null)),
		];
		const access = new Map(
			await Promise.all(
				owners.map(
					async (owner) =>
						[owner, await this.portalAccess.hasAccess(owner)] as const
				)
			)
		);
		return orgs.map((org) =>
			MyOrganizationResponseDto.withPortal(
				org,
				org.ownerUserId !== null && access.get(org.ownerUserId) === true
			)
		);
	}
}
