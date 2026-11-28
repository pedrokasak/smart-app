import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseFilters,
	UseGuards,
	UseInterceptors,
	applyDecorators,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { AlertService } from 'src/advisor/application/attention/alert.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import {
	ApiBffCommonResponses,
	ApiOrgHeader,
	INVALID_ID_DESCRIPTION,
	VALIDATION_FAILED_DESCRIPTION,
} from './api-bff-responses';
import {
	AlertPageResponseDto,
	AlertResponseDto,
	BulkAlertsDto,
	BulkAlertsResponseDto,
	CreateAlertDto,
	DismissAlertDto,
	HandleAlertDto,
	HandleAlertResponseDto,
	ListAlertsQueryDto,
	SnoozeAlertDto,
} from './dto/alert.dto';
import { DEFAULT_PAGE_LIMIT } from './dto/client.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { OrgPortalGuard } from './org-portal.guard';
import { accessContextOf } from './request-context';

const FIELD_DESCRIPTION = `${VALIDATION_FAILED_DESCRIPTION}; recusado pelo serviço, com details.field`;

const FORBIDDEN = ApiResponse({
	status: 403,
	type: ErrorResponseDto,
	description:
		'Sem acesso ao portal, ORG_HEADER_REQUIRED ou org de que não é membro',
});

/** Erros das ações sobre um alerta. */
function ApiAlertActionErrors() {
	return applyDecorators(
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description: `${FIELD_DESCRIPTION}, ou ${INVALID_ID_DESCRIPTION}`,
		}),
		FORBIDDEN,
		ApiResponse({
			status: 404,
			type: ErrorResponseDto,
			description:
				'Alerta inexistente, de outra org ou de cliente fora do alcance (o mesmo 404 de cliente inexistente)',
		}),
		ApiResponse({
			status: 409,
			type: ErrorResponseDto,
			description:
				'ALERT_NOT_ACTIVE: o alerta já foi tratado, descartado ou resolvido',
		})
	);
}

/**
 * Fila de alertas da org ativa e as ações sobre ela. Só traduz HTTP: o
 * `AlertService` decide o alcance (ADVISOR só os clientes atribuídos) e
 * audita cada leitura e escrita.
 */
@Controller('advisor/v1/alerts')
@OwnershipChecked(
	'Service: AlertService busca o alerta na org ativa e confere que o cliente está no alcance do membro (isClientInScope); fora disso, o mesmo 404'
)
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard, OrgPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class AlertsController {
	constructor(private readonly alerts: AlertService) {}

	@Get()
	@ApiOperation({
		summary:
			'Fila de alertas, por prioridade, prazo e data (padrão: status OPEN)',
	})
	@ApiResponse({ status: 200, type: AlertPageResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `${VALIDATION_FAILED_DESCRIPTION}: status, priority, rule, limit ou assignee; INVALID_CURSOR; ASSIGNEE_FILTER_FORBIDDEN (assignee enviado por um ADVISOR)`,
	})
	@FORBIDDEN
	async list(
		@Req() req: any,
		@Query() query: ListAlertsQueryDto
	): Promise<AlertPageResponseDto> {
		const page = await this.alerts.list(accessContextOf(req), {
			statuses: query.status,
			priorities: query.priority,
			rules: query.rule,
			cursor: query.cursor,
			limit: query.limit ?? DEFAULT_PAGE_LIMIT,
			...(query.assignee !== undefined && { assignee: query.assignee }),
		});
		return AlertPageResponseDto.of(page);
	}

	@Post()
	@ApiOperation({ summary: 'Cria um alerta MANUAL para um cliente' })
	@ApiResponse({ status: 201, type: AlertResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `${FIELD_DESCRIPTION} (title, note, dueDate)`,
	})
	@FORBIDDEN
	@ApiResponse({
		status: 404,
		type: ErrorResponseDto,
		description: 'Cliente inexistente, de outra org ou fora do alcance',
	})
	async create(
		@Req() req: any,
		@Body() body: CreateAlertDto
	): Promise<AlertResponseDto> {
		const alert = await this.alerts.create(accessContextOf(req), {
			clientProfileId: body.clientId,
			title: body.title,
			priority: body.priority,
			...(body.dueDate !== undefined && { dueDate: body.dueDate }),
			...(body.note !== undefined && { note: body.note }),
		});
		return AlertResponseDto.of(alert);
	}

	@Post('bulk')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary:
			'Ação em lote (REVIEW, SNOOZE, DISMISS) por ids ou filtro, até 500 alertas',
	})
	@ApiResponse({ status: 200, type: BulkAlertsResponseDto })
	@ApiResponse({
		status: 400,
		type: ErrorResponseDto,
		description: `${FIELD_DESCRIPTION} (ids, until, reason); details.max quando o filtro passa de 500; ASSIGNEE_FILTER_FORBIDDEN`,
	})
	@FORBIDDEN
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 20 lotes por minuto por conta e por IP',
	})
	async bulk(
		@Req() req: any,
		@Body() body: BulkAlertsDto
	): Promise<BulkAlertsResponseDto> {
		const result = await this.alerts.bulk(accessContextOf(req), {
			action: body.action,
			...(body.ids !== undefined && { ids: body.ids }),
			...(body.filter !== undefined && {
				filter: {
					statuses: body.filter.statuses,
					priorities: body.filter.priorities,
					rules: body.filter.rules,
					...(body.filter.assignee !== undefined && {
						assignee: body.filter.assignee,
					}),
				},
			}),
			...(body.until !== undefined && { until: body.until }),
			...(body.reason !== undefined && { reason: body.reason }),
		});
		return { affected: result.affected, skipped: result.skipped };
	}

	@Post(':id/handle')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary:
			'Trata o alerta (EMAIL ou REVIEWED); com EMAIL, devolve o rascunho',
	})
	@ApiResponse({ status: 200, type: HandleAlertResponseDto })
	@ApiAlertActionErrors()
	async handle(
		@Req() req: any,
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: HandleAlertDto
	): Promise<HandleAlertResponseDto> {
		const result = await this.alerts.handle(accessContextOf(req), id, {
			via: body.via,
			...(body.note !== undefined && { note: body.note }),
		});
		return HandleAlertResponseDto.of(result);
	}

	@Post(':id/snooze')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Adia o alerta até uma data (até 90 dias)' })
	@ApiResponse({ status: 204 })
	@ApiAlertActionErrors()
	async snooze(
		@Req() req: any,
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: SnoozeAlertDto
	): Promise<void> {
		await this.alerts.snooze(accessContextOf(req), id, body.until);
	}

	@Post(':id/dismiss')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Descarta o alerta, com motivo' })
	@ApiResponse({ status: 204 })
	@ApiAlertActionErrors()
	async dismiss(
		@Req() req: any,
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() body: DismissAlertDto
	): Promise<void> {
		await this.alerts.dismiss(accessContextOf(req), id, body.reason);
	}
}
