import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
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
import { MemberInviteService } from 'src/advisor/application/member-invite.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { requesterIdOf } from 'src/auth/ownership';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import {
	ApiBffCommonResponses,
	VALIDATION_FAILED_DESCRIPTION,
} from './api-bff-responses';
import { ErrorResponseDto } from './dto/error-response.dto';
import {
	AcceptMemberInviteResponseDto,
	MemberInvitePreviewResponseDto,
	MemberInviteTokenDto,
	NoQueryDto,
} from './dto/member-invite.dto';

/** Erros comuns às três rotas do convidado (§6.3 do spec). */
function ApiGuestInviteErrors() {
	return applyDecorators(
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description: `${VALIDATION_FAILED_DESCRIPTION}: token ausente, fora do tamanho ou na query`,
		}),
		ApiResponse({
			status: 404,
			type: ErrorResponseDto,
			description:
				'Token inválido, vencido, já usado ou de outro e-mail (sem distinção)',
		}),
		ApiResponse({
			status: 429,
			type: ErrorResponseDto,
			description: 'Limite de 5 por minuto por conta e por IP',
		})
	);
}

/**
 * O convidado abre o link do e-mail (`/convite-equipe#token=...`). Só JWT:
 * quem ainda não é membro não tem org ativa nem portal. O token vai sempre
 * no corpo; na query é 400 (`NoQueryDto`).
 */
@Controller('advisor/v1/me/member-invites')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class MeMemberInvitesController {
	constructor(private readonly invites: MemberInviteService) {}

	@Post('preview')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Mostra o escritório do convite' })
	@ApiResponse({ status: 200, type: MemberInvitePreviewResponseDto })
	@ApiGuestInviteErrors()
	async preview(
		@Req() req: any,
		@Query() _query: NoQueryDto,
		@Body() body: MemberInviteTokenDto
	): Promise<MemberInvitePreviewResponseDto> {
		const preview = await this.invites.preview(requesterIdOf(req), body.token);
		return MemberInvitePreviewResponseDto.of(preview);
	}

	@Post('accept')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Aceita o convite e entra como ADVISOR' })
	@ApiResponse({ status: 200, type: AcceptMemberInviteResponseDto })
	@ApiResponse({
		status: 409,
		type: ErrorResponseDto,
		description: 'ALREADY_MEMBER: a conta já é membro da organização',
	})
	@ApiGuestInviteErrors()
	async accept(
		@Req() req: any,
		@Query() _query: NoQueryDto,
		@Body() body: MemberInviteTokenDto
	): Promise<AcceptMemberInviteResponseDto> {
		return this.invites.accept(requesterIdOf(req), body.token);
	}

	@Post('decline')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Recusa o convite' })
	@ApiResponse({ status: 204 })
	@ApiGuestInviteErrors()
	async decline(
		@Req() req: any,
		@Query() _query: NoQueryDto,
		@Body() body: MemberInviteTokenDto
	): Promise<void> {
		await this.invites.decline(requesterIdOf(req), body.token);
	}
}
