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
import { MemberInviteService } from 'src/advisor/application/member-invite.service';
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
import { ErrorResponseDto } from './dto/error-response.dto';
import { ResendInviteResponseDto } from './dto/invite.dto';
import {
	CreateMemberInviteDto,
	CreateMemberInviteResponseDto,
	PendingMemberInviteResponseDto,
} from './dto/member-invite.dto';
import { OrgPortalGuard } from './org-portal.guard';
import { accessContextOf } from './request-context';

const ADMIN_FORBIDDEN =
	'ROLE_REQUIRED (ADVISOR numa rota de ORG_ADMIN). Sem acesso ao portal, ORG_HEADER_REQUIRED ou não é membro da org';

/** Erros comuns às rotas de convite de membro (§6.2 do spec). */
function ApiMemberInviteErrors(options: {
	validation: string;
	notFound?: boolean;
	conflict: string;
}) {
	const decorators = [
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description: options.validation,
		}),
		ApiResponse({
			status: 403,
			type: ErrorResponseDto,
			description: ADMIN_FORBIDDEN,
		}),
		ApiResponse({
			status: 409,
			type: ErrorResponseDto,
			description: options.conflict,
		}),
	];
	if (options.notFound) {
		decorators.push(
			ApiResponse({
				status: 404,
				type: ErrorResponseDto,
				description: 'Convite inexistente ou de outra org',
			})
		);
	}
	return applyDecorators(...decorators);
}

/**
 * Convites de membro da org ativa, só para ORG_ADMIN. Só traduz HTTP; o
 * `MemberInviteService` valida, audita e envia o e-mail, e a listagem só
 * devolve o e-mail mascarado. Criar e reenviar têm limite próprio no
 * middleware de rate limit.
 */
@Controller('advisor/v1/member-invites')
@OwnershipChecked(
	'MemberInviteService: o convite é buscado por (orgId ativa, inviteId), só para ORG_ADMIN'
)
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard, OrgPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class MemberInvitesController {
	constructor(private readonly invites: MemberInviteService) {}

	@Get()
	@ApiOperation({ summary: 'Lista os convites de membro pendentes' })
	@ApiResponse({ status: 200, type: [PendingMemberInviteResponseDto] })
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: ADMIN_FORBIDDEN,
	})
	async list(@Req() req: any): Promise<PendingMemberInviteResponseDto[]> {
		const pending = await this.invites.listPending(accessContextOf(req));
		return pending.map(PendingMemberInviteResponseDto.of);
	}

	@Post()
	@ApiOperation({ summary: 'Convida um ADVISOR por e-mail' })
	@ApiResponse({
		status: 201,
		type: CreateMemberInviteResponseDto,
		description: 'Mesma resposta para e-mail com ou sem conta Trackerr',
	})
	@ApiMemberInviteErrors({
		validation: `INVALID_EMAIL ou ${VALIDATION_FAILED_DESCRIPTION}`,
		conflict:
			'ALREADY_MEMBER: o e-mail já é de um membro; PENDING_INVITE: já há convite ativo para o e-mail',
	})
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 10 convites por 10 minutos por conta e por IP',
	})
	async create(
		@Req() req: any,
		@Body() body: CreateMemberInviteDto
	): Promise<CreateMemberInviteResponseDto> {
		const created = await this.invites.createInvite(accessContextOf(req), {
			email: body.email,
		});
		return CreateMemberInviteResponseDto.of(created);
	}

	@Post(':inviteId/resend')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Reenvia o convite com um novo link' })
	@ApiResponse({ status: 200, type: ResendInviteResponseDto })
	@ApiMemberInviteErrors({
		validation: INVALID_ID_DESCRIPTION,
		notFound: true,
		conflict: 'RESEND_LIMIT (já reenviado 3 vezes) ou NOT_PENDING',
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
		const resent = await this.invites.resend(accessContextOf(req), inviteId);
		return ResendInviteResponseDto.of(resent);
	}

	@Delete(':inviteId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Cancela um convite de membro pendente' })
	@ApiResponse({ status: 204 })
	@ApiMemberInviteErrors({
		validation: INVALID_ID_DESCRIPTION,
		notFound: true,
		conflict: 'NOT_PENDING: o convite já foi respondido ou cancelado',
	})
	async cancel(
		@Req() req: any,
		@Param('inviteId', new ParseUUIDPipe()) inviteId: string
	): Promise<void> {
		await this.invites.cancel(accessContextOf(req), inviteId);
	}
}
