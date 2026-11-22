import {
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
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
import { TeamService } from 'src/advisor/application/team.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { ApiBffCommonResponses, ApiOrgHeader } from './api-bff-responses';
import { ErrorResponseDto } from './dto/error-response.dto';
import {
	PromoteMemberResponseDto,
	TeamMemberResponseDto,
} from './dto/member.dto';
import { OrgPortalGuard } from './org-portal.guard';
import { accessContextOf } from './request-context';
import { ParseUserIdPipe } from './user-id.pipe';

const MEMBER_FORBIDDEN =
	'Sem acesso ao portal, ORG_HEADER_REQUIRED ou não é membro da org';

const INVALID_USER_ID = 'userId fora do formato de id de usuário (sem reason)';

/** Erros das rotas de `ORG_ADMIN` com `:userId` (§6.2 do spec). */
function ApiMemberAdminErrors(conflict?: string) {
	const decorators = [
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description: INVALID_USER_ID,
		}),
		ApiResponse({
			status: 403,
			type: ErrorResponseDto,
			description: `ROLE_REQUIRED (ADVISOR numa rota de ORG_ADMIN). ${MEMBER_FORBIDDEN}`,
		}),
		ApiResponse({
			status: 404,
			type: ErrorResponseDto,
			description: 'Usuário que não é membro da org',
		}),
	];
	if (conflict) {
		decorators.push(
			ApiResponse({
				status: 409,
				type: ErrorResponseDto,
				description: conflict,
			})
		);
	}
	return applyDecorators(...decorators);
}

/**
 * Equipe da org ativa: listar, remover e promover (sair fica em
 * `MeMembershipController`, sem o guard de portal). Só traduz HTTP; o
 * `TeamService` decide o papel, audita e desfaz em caso de falha.
 */
@Controller('advisor/v1')
@OwnershipChecked(
	'TeamService: o membro é buscado por (orgId ativa, userId) e só ORG_ADMIN remove ou promove'
)
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@ApiOrgHeader()
@ApiBffCommonResponses()
@UseGuards(JwtAuthGuard, OrgContextGuard, OrgPortalGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class MembersController {
	constructor(private readonly team: TeamService) {}

	@Get('members')
	@ApiOperation({ summary: 'Lista a equipe da organização' })
	@ApiResponse({ status: 200, type: [TeamMemberResponseDto] })
	@ApiResponse({
		status: 403,
		type: ErrorResponseDto,
		description: MEMBER_FORBIDDEN,
	})
	async list(@Req() req: any): Promise<TeamMemberResponseDto[]> {
		const members = await this.team.listMembers(accessContextOf(req));
		return members.map(TeamMemberResponseDto.of);
	}

	@Delete('members/:userId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Remove o membro e as atribuições dele' })
	@ApiResponse({ status: 204 })
	@ApiMemberAdminErrors('OWNER_CANNOT_BE_REMOVED: o dono não é removido')
	async remove(
		@Req() req: any,
		@Param('userId', ParseUserIdPipe) userId: string
	): Promise<void> {
		await this.team.removeMember(accessContextOf(req), userId);
	}

	@Post('members/:userId/promote')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Promove um ADVISOR a ORG_ADMIN (já ORG_ADMIN: 200 sem mudança)',
	})
	@ApiResponse({ status: 200, type: PromoteMemberResponseDto })
	@ApiMemberAdminErrors()
	async promote(
		@Req() req: any,
		@Param('userId', ParseUserIdPipe) userId: string
	): Promise<PromoteMemberResponseDto> {
		return this.team.promote(accessContextOf(req), userId);
	}
}
