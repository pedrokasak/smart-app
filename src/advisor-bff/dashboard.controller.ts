import {
	Controller,
	Get,
	Query,
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
import {
	DASHBOARD_DEFAULT_DAYS,
	DashboardService,
} from 'src/advisor/application/attention/dashboard.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import {
	ApiBffCommonResponses,
	ApiOrgHeader,
	VALIDATION_FAILED_DESCRIPTION,
} from './api-bff-responses';
import { DashboardQueryDto, DashboardResponseDto } from './dto/dashboard.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { OrgPortalGuard } from './org-portal.guard';
import { accessContextOf } from './request-context';

/**
 * Painel do assessor, só do read model (snapshots, série diária e alertas),
 * dentro do que o membro vê. O `DashboardService` decide o alcance e audita
 * a leitura.
 */
@Controller('advisor/v1/dashboard')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard, OrgPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class DashboardController {
	constructor(private readonly dashboard: DashboardService) {}

	@Get()
	@ApiOperation({
		summary: 'KPIs, top 5 alertas, próximos prazos e a série de evolução',
	})
	@ApiResponse({ status: 200, type: DashboardResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `${VALIDATION_FAILED_DESCRIPTION}: days (inteiro de 7 a 365)`,
	})
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description:
			'Sem acesso ao portal, ORG_HEADER_REQUIRED ou org de que não é membro',
	})
	async get(
		@Req() req: any,
		@Query() query: DashboardQueryDto
	): Promise<DashboardResponseDto> {
		const dashboard = await this.dashboard.get(
			accessContextOf(req),
			query.days ?? DASHBOARD_DEFAULT_DAYS
		);
		return DashboardResponseDto.of(dashboard);
	}
}
