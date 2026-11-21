import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { requesterIdOf } from 'src/auth/ownership';
import {
	AdvisorPortalGrantListItemDto,
	AdvisorPortalGrantResponseDto,
	AdvisorPortalUserParamDto,
	GrantAdvisorPortalDto,
} from './dto/advisor-portal-grant.dto';

/**
 * Liberação do portal do assessor no piloto (Trackerr Advisor P3a, U6).
 * Só traduz HTTP; a regra e a auditoria ficam no `PortalAccessService`.
 * Não toca a assinatura B2C do usuário.
 */
@Controller('admin/advisor-portal-access')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(Role.Admin)
export class AdminAdvisorPortalController {
	constructor(private readonly portal: PortalAccessService) {}

	@Post()
	@ApiOperation({ summary: 'Libera o portal do assessor para uma conta' })
	@ApiResponse({ status: 201, type: AdvisorPortalGrantResponseDto })
	@ApiResponse({ status: 404, description: 'E-mail sem conta' })
	grant(
		@Req() req: any,
		@Body() body: GrantAdvisorPortalDto
	): Promise<AdvisorPortalGrantResponseDto> {
		return this.portal.grantByEmail(requesterIdOf(req), body.email);
	}

	@Delete(':userId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Revoga a liberação do portal do assessor' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 404, description: 'Sem liberação ativa' })
	async revoke(
		@Req() req: any,
		@Param() params: AdvisorPortalUserParamDto
	): Promise<void> {
		await this.portal.revoke(requesterIdOf(req), params.userId);
	}

	@Get()
	@ApiOperation({ summary: 'Lista as liberações ativas do portal' })
	@ApiResponse({ status: 200, type: [AdvisorPortalGrantListItemDto] })
	list(): Promise<AdvisorPortalGrantListItemDto[]> {
		return this.portal.listGrants();
	}
}
