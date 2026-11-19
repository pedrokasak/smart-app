import {
	Body,
	Controller,
	Get,
	HttpCode,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import {
	AgentActor,
	AgentControlService,
} from 'src/agent-control/application/agent-control.service';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import {
	ListAgentChangesQueryDto,
	PauseAllAiAgentsDto,
	UpdateAgentControlDto,
} from './dto/agent-control.dto';

/**
 * Painel de agentes (ADR-005, seção 9). Ler: ADMIN e EDITOR. Mudar: só
 * ADMIN, com o código 2FA no corpo de cada mudança.
 */
@Controller('admin/agents')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class AgentControlAdminController {
	constructor(private readonly agents: AgentControlService) {}

	@Get()
	@Roles(Role.Admin, Role.Editor)
	@ApiOperation({
		summary:
			'Agentes de IA e jobs de dados com estado efetivo, origem do estado e configuração (ADR-005)',
	})
	list() {
		return this.agents.list();
	}

	@Get('changes')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Histórico de mudanças de todos os agentes' })
	listAllChanges(@Query() query: ListAgentChangesQueryDto) {
		return this.agents.changes(null, query.limit);
	}

	@Post('pause-ai')
	@HttpCode(200)
	@Roles(Role.Admin)
	@ApiOperation({
		summary: 'Pausa por 2 horas todos os agentes de IA ligados (2FA e motivo)',
	})
	pauseAllAi(@Req() req: any, @Body() body: PauseAllAiAgentsDto) {
		return this.agents.pauseAllAi(this.actorOf(req), body);
	}

	@Get(':id')
	@Roles(Role.Admin, Role.Editor)
	@ApiOperation({
		summary: 'Um agente, com a configuração e os campos editáveis',
	})
	get(@Param('id') id: string) {
		return this.agents.get(id);
	}

	@Get(':id/changes')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Histórico de mudanças de um agente' })
	listChanges(
		@Param('id') id: string,
		@Query() query: ListAgentChangesQueryDto
	) {
		return this.agents.changes(id, query.limit);
	}

	@Patch(':id')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Liga, desliga, pausa ou configura um agente (2FA, motivo e versão otimista)',
	})
	update(
		@Req() req: any,
		@Param('id') id: string,
		@Body() body: UpdateAgentControlDto
	) {
		const { version, totp, ...change } = body;
		return this.agents.change(this.actorOf(req), id, {
			...change,
			version,
			totp,
		});
	}

	private actorOf(req: any): AgentActor {
		const raw = req.user?.userId ?? req.user?._id ?? req.user?.id;
		// Sem id não há a quem pedir o 2FA nem quem registrar no histórico.
		if (raw === undefined || raw === null || raw === '') {
			throw new UnauthorizedException('Sessão sem usuário identificado.');
		}
		const userId = String(raw);
		return { userId, ref: actorRefOf(userId), ip: req.ip ?? null };
	}
}
