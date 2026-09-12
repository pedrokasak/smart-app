import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { TargetAllocationService } from './target-allocation.service';
import { UpsertTargetAllocationDto } from './dto/upsert-target-allocation.dto';
import { TargetAllocationResponseDto } from './dto/target-allocation-response.dto';

/** O payload do JWT variou entre versões; aceita as formas já emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Meta de alocação-alvo do portfólio (TRA-68).
 *
 * Substitui a leitura direta de `localStorage` que existia em
 * `web/src/pages/Index.tsx` — a meta nunca era persistida em servidor e
 * portanto não sobrevivia à troca de dispositivo/navegador.
 */
@Controller('portfolio/target-allocation')
@ApiTags('Portfolio Target Allocation')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class TargetAllocationController {
	constructor(
		private readonly targetAllocationService: TargetAllocationService
	) {}

	@Get()
	@ApiOkResponse({
		type: TargetAllocationResponseDto,
		description:
			'Meta de alocação do usuário autenticado, ou null se nunca configurada.',
	})
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	async getMyTargetAllocation(
		@Req() req: any
	): Promise<TargetAllocationResponseDto | null> {
		const userId = resolveUserId(req);
		const target = await this.targetAllocationService.findByUser(userId);
		if (!target) return null;

		return {
			stocks: target.stocks,
			crypto: target.crypto,
			fiis: target.fiis,
			other: target.other,
		};
	}

	@Put()
	@ApiOkResponse({
		type: TargetAllocationResponseDto,
		description: 'Meta de alocação atualizada.',
	})
	@ApiResponse({ status: 400, description: 'Bad Request.' })
	@ApiResponse({ status: 401, description: 'Unauthorized.' })
	async upsertMyTargetAllocation(
		@Body() dto: UpsertTargetAllocationDto,
		@Req() req: any
	): Promise<TargetAllocationResponseDto> {
		const userId = resolveUserId(req);
		const updated = await this.targetAllocationService.upsertForUser(
			userId,
			dto
		);

		return {
			stocks: updated.stocks,
			crypto: updated.crypto,
			fiis: updated.fiis,
			other: updated.other,
		};
	}
}
