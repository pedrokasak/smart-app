import {
	Controller,
	Delete,
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
import { TeamService } from 'src/advisor/application/team.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { ApiBffCommonResponses, ApiOrgHeader } from './api-bff-responses';
import { ErrorResponseDto } from './dto/error-response.dto';
import { accessContextOf } from './request-context';

/**
 * Sair do escritório não depende da liberação do dono (R10): sem o guard de
 * portal, o membro sai mesmo quando o escritório está bloqueado. Só a
 * membership da org ativa (`OrgContextGuard`) é exigida.
 */
@Controller('advisor/v1/me/membership')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class MeMembershipController {
	constructor(private readonly team: TeamService) {}

	@Delete()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Sai da organização ativa' })
	@ApiResponse({ status: 204 })
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: 'ORG_HEADER_REQUIRED ou não é membro da org',
	})
	@ApiResponse({
		status: 409,
		type: ErrorResponseDto,
		description: 'OWNER_CANNOT_LEAVE: o dono não sai da organização',
	})
	async leave(@Req() req: any): Promise<void> {
		await this.team.leave(accessContextOf(req));
	}
}
