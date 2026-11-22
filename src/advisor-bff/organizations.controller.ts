import {
	Body,
	Controller,
	Post,
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
import { OrgRole } from 'src/advisor/domain/enums';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { requesterIdOf } from 'src/auth/ownership';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import {
	ApiBffCommonResponses,
	VALIDATION_FAILED_DESCRIPTION,
} from './api-bff-responses';
import { ErrorResponseDto } from './dto/error-response.dto';
import {
	CreateOrganizationDto,
	OrganizationResponseDto,
} from './dto/organization.dto';

/**
 * Organização do assessor, antes de haver uma org ativa: por isso sem
 * `OrgContextGuard`. Só traduz HTTP; as regras ficam em `OrganizationService`.
 */
@Controller('advisor/v1')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, AdvisorPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class OrganizationsController {
	constructor(private readonly organizations: OrganizationService) {}

	@Post('organizations')
	@ApiOperation({ summary: 'Cria a organização do usuário (uma por dono)' })
	@ApiResponse({ status: 201, type: OrganizationResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `INVALID_NAME (em branco, fora do tamanho ou com caractere de controle) ou ${VALIDATION_FAILED_DESCRIPTION}, como advisorType fora do enum`,
	})
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description:
			'EMAIL_NOT_VERIFIED ou PLAN_CAPABILITY_REQUIRED (sem acesso ao portal)',
	})
	@ApiResponse({
		status: 409,
		type: ErrorResponseDto,
		description: 'ALREADY_OWNS_ORGANIZATION',
	})
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 5 criações por minuto por conta e por IP',
	})
	async create(
		@Req() req: any,
		@Body() body: CreateOrganizationDto
	): Promise<OrganizationResponseDto> {
		const org = await this.organizations.createForOwner(requesterIdOf(req), {
			name: body.name,
			advisorType: body.advisorType,
		});
		return OrganizationResponseDto.of({
			id: org.id,
			name: org.name,
			advisorType: org.advisorType,
			role: OrgRole.OrgAdmin,
		});
	}
}
