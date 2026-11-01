import {
	Controller,
	Get,
	Inject,
	NotFoundException,
	Param,
	Request,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import {
	GENERATION_RECORD_STORE,
	GenerationRecordStore,
} from './application/generation-recorder.service';

/**
 * "Link da trilha de auditoria" de um insight (ADR-004, 9.2): o dono vê de
 * que prompt, modelo e dados saiu a resposta dele. Só ids e hashes; o
 * registro de outra pessoa responde 404, igual a um id que não existe.
 */
@Controller('ai/generations')
@ApiTags('ai')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class GenerationRecordsController {
	constructor(
		@Inject(GENERATION_RECORD_STORE)
		private readonly store: GenerationRecordStore
	) {}

	@Get(':generationId')
	@OwnershipChecked(
		'userRef do registro igual ao HMAC do usuário; outro dono responde 404'
	)
	@ApiOperation({ summary: 'Proveniência de uma resposta de IA do usuário' })
	async get(@Request() req: any, @Param('generationId') generationId: string) {
		const userId = String(req.user?.userId ?? req.user?.sub ?? '');
		if (!userId) throw new UnauthorizedException('User ID ausente no token');

		const record = await this.store.findByGenerationId(generationId);
		if (!record || record.userRef !== actorRefOf(userId)) {
			throw new NotFoundException('Registro não encontrado');
		}
		// `userRef` fica de fora: é o pseudônimo, sem valor para quem o recebe.
		return { ...record, userRef: undefined };
	}
}
