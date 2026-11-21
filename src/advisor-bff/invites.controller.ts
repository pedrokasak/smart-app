import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Post,
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
import { ClientDirectoryService } from 'src/advisor/application/client-directory.service';
import { InviteService } from 'src/advisor/application/invite.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import { ErrorResponseDto } from './dto/error-response.dto';
import {
	CreateInviteDto,
	CreateInviteResponseDto,
	PendingInviteResponseDto,
	ResendInviteResponseDto,
} from './dto/invite.dto';
import { accessContextOf } from './request-context';

/** Erros comuns às rotas de convite (§5.3 do spec). */
function ApiInviteErrors(options: { validation: string; conflict?: string }) {
	const decorators = [
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description: options.validation,
		}),
		ApiResponse({
			status: 403,
			type: ErrorResponseDto,
			description: 'Sem acesso ao portal ou não é membro da org',
		}),
		ApiResponse({
			status: 404,
			type: ErrorResponseDto,
			description: 'Convite inexistente ou de outra org',
		}),
	];
	if (options.conflict) {
		decorators.push(
			ApiResponse({
				status: 409,
				type: ErrorResponseDto,
				description: options.conflict,
			})
		);
	}
	return applyDecorators(...decorators);
}

/**
 * Convites da org ativa. Só traduz HTTP; o `InviteService` valida, audita e
 * envia o e-mail, e a listagem só devolve o e-mail mascarado. As rotas que
 * enviam e-mail têm limite por conta no middleware de rate limit.
 */
@Controller('advisor/v1/invites')
@OwnershipChecked(
	'InviteService: o convite é buscado por (orgId ativa, inviteId)'
)
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AdvisorPortalGuard, OrgContextGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class InvitesController {
	constructor(
		private readonly invites: InviteService,
		private readonly directory: ClientDirectoryService
	) {}

	@Get()
	@ApiOperation({ summary: 'Lista os convites pendentes da organização' })
	@ApiResponse({ status: 200, type: [PendingInviteResponseDto] })
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: 'Sem acesso ao portal ou não é membro da org',
	})
	async list(@Req() req: any): Promise<PendingInviteResponseDto[]> {
		const pending = await this.directory.listPendingInvites(
			accessContextOf(req)
		);
		return pending.map((invite) => PendingInviteResponseDto.of(invite));
	}

	@Post()
	@ApiOperation({ summary: 'Cria um convite e envia o e-mail' })
	@ApiResponse({ status: 201, type: CreateInviteResponseDto })
	@ApiInviteErrors({
		validation: 'INVALID_EMAIL, INVALID_NAME ou corpo inválido',
		conflict: 'PENDING_INVITE: já há convite ativo para este e-mail',
	})
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 10 convites por 10 minutos por conta e por IP',
	})
	async create(
		@Req() req: any,
		@Body() body: CreateInviteDto
	): Promise<CreateInviteResponseDto> {
		const created = await this.invites.createInvite(accessContextOf(req), {
			email: body.email,
			clientName: body.clientName,
		});
		return CreateInviteResponseDto.of(created);
	}

	@Post(':inviteId/resend')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Reenvia o convite com um novo link' })
	@ApiResponse({ status: 200, type: ResendInviteResponseDto })
	@ApiInviteErrors({
		validation: 'inviteId fora do formato',
		conflict: 'RESEND_LIMIT ou NOT_PENDING',
	})
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 10 reenvios por 10 minutos por conta e por IP',
	})
	async resend(
		@Req() req: any,
		@Param('inviteId', new ParseUUIDPipe()) inviteId: string
	): Promise<ResendInviteResponseDto> {
		const resent = await this.invites.resendInvite(
			accessContextOf(req),
			inviteId
		);
		return ResendInviteResponseDto.of(resent);
	}

	@Delete(':inviteId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Cancela um convite pendente' })
	@ApiResponse({ status: 204 })
	@ApiInviteErrors({
		validation: 'inviteId fora do formato',
		conflict: 'NOT_PENDING: o convite já foi respondido ou cancelado',
	})
	async cancel(
		@Req() req: any,
		@Param('inviteId', new ParseUUIDPipe()) inviteId: string
	): Promise<void> {
		await this.invites.cancelInvite(accessContextOf(req), inviteId);
	}
}
