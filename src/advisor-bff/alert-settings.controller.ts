import {
	Body,
	Controller,
	Get,
	Put,
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
import { AlertSettingsService } from 'src/advisor/application/attention/alert-settings.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import {
	ApiBffCommonResponses,
	ApiOrgHeader,
	VALIDATION_FAILED_DESCRIPTION,
} from './api-bff-responses';
import {
	AlertSettingsResponseDto,
	PutAlertSettingsDto,
} from './dto/alert-settings.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { OrgPortalGuard } from './org-portal.guard';
import { accessContextOf } from './request-context';

const FORBIDDEN_DESCRIPTION =
	'Sem acesso ao portal, ORG_HEADER_REQUIRED ou org de que não é membro';

/**
 * Limites das regras de alerta da org ativa (B5, B8). Qualquer membro lê;
 * só ORG_ADMIN grava (o serviço decide e audita).
 */
@Controller('advisor/v1/alert-settings')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard, OrgPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class AlertSettingsController {
	constructor(private readonly settings: AlertSettingsService) {}

	@Get()
	@ApiOperation({
		summary: 'Limites da organização (os padrões quando nada foi salvo)',
	})
	@ApiResponse({ status: 200, type: AlertSettingsResponseDto })
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: FORBIDDEN_DESCRIPTION,
	})
	async get(@Req() req: any): Promise<AlertSettingsResponseDto> {
		const view = await this.settings.get(accessContextOf(req));
		return AlertSettingsResponseDto.of(view);
	}

	@Put()
	@ApiOperation({
		summary:
			'Grava o conjunto inteiro de limites (campo omitido volta ao padrão)',
	})
	@ApiResponse({ status: 200, type: AlertSettingsResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `${VALIDATION_FAILED_DESCRIPTION}: valor fora da faixa; faixas fora de ordem, com details.field`,
	})
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: `ROLE_REQUIRED (ADVISOR). ${FORBIDDEN_DESCRIPTION}`,
	})
	async put(
		@Req() req: any,
		@Body() body: PutAlertSettingsDto
	): Promise<AlertSettingsResponseDto> {
		const view = await this.settings.put(accessContextOf(req), {
			...(body.noContactDays !== undefined && {
				noContactDays: body.noContactDays,
			}),
			...(body.positionDropPct !== undefined && {
				positionDropPct: body.positionDropPct,
			}),
			...(body.portfolioDrawdownPct !== undefined && {
				portfolioDrawdownPct: body.portfolioDrawdownPct,
			}),
			...(body.concentrationPct !== undefined && {
				concentrationPct: body.concentrationPct,
			}),
			...(body.targetDriftPp !== undefined && {
				targetDriftPp: body.targetDriftPp,
			}),
			...(body.largeSellsPct !== undefined && {
				largeSellsPct: body.largeSellsPct,
			}),
		});
		return AlertSettingsResponseDto.of(view);
	}
}
