import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { FixedIncomePositionsService } from './application/fixed-income-positions.service';
import { CreateFixedIncomePositionDto } from './dto/create-fixed-income-position.dto';

/** O payload do JWT variou entre versões; aceita as formas já emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/** Cadastro de renda fixa na carteira (TRA-230). */
@Controller('portfolio/:portfolioId/fixed-income')
@ApiTags('Portfolio Fixed Income')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class FixedIncomePositionsController {
	constructor(private readonly positions: FixedIncomePositionsService) {}

	@OwnershipChecked('assertOwnership / carteira do userId do token')
	@Post()
	@ApiResponse({
		status: 201,
		description:
			'Posição de renda fixa criada, já marcada na curva até hoje quando as séries estão disponíveis.',
	})
	@ApiResponse({ status: 400, description: 'Dados incoerentes.' })
	@ApiResponse({ status: 403, description: 'Cota de ativos do plano.' })
	@ApiResponse({ status: 404, description: 'Carteira não encontrada.' })
	async create(
		@Param('portfolioId') portfolioId: string,
		@Body() dto: CreateFixedIncomePositionDto,
		@Req() req: any
	) {
		const asset = await this.positions.create(resolveUserId(req), portfolioId, {
			kind: dto.kind,
			indexer: dto.indexer,
			ratePct: dto.ratePct,
			principal: dto.principal,
			appliedAt: dto.appliedAt,
			maturityDate: dto.maturityDate ?? null,
		});
		return AssetMapper.toResponseDto(asset as any);
	}
}
