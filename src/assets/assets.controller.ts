import {
	Controller,
	Get,
	Body,
	Patch,
	Param,
	Delete,
	Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { requesterIdOf } from 'src/auth/ownership';
import { AssetsService } from './assets.service';
import { UpdateAssetDto } from './dto/update-asset.dto';

/**
 * Ativo pertence a uma carteira, e a carteira a um usuário: toda rota
 * confere essa cadeia (TRA-211). Criação acontece pelo fluxo de carteira.
 */
@Controller('assets')
@ApiTags('assets')
export class AssetsController {
	constructor(private readonly assetsService: AssetsService) {}

	@Get()
	findAll(@Req() req: any) {
		return this.assetsService.findAllForUser(requesterIdOf(req));
	}

	@Get(':id')
	findOne(@Param('id') id: string, @Req() req: any) {
		return this.assetsService.findOwned(requesterIdOf(req), id);
	}

	@Patch(':id')
	async update(
		@Param('id') id: string,
		@Body() updateAssetDto: UpdateAssetDto,
		@Req() req: any
	) {
		await this.assetsService.findOwned(requesterIdOf(req), id);
		return this.assetsService.update(id, updateAssetDto);
	}

	@Delete(':id')
	async remove(@Param('id') id: string, @Req() req: any) {
		const asset = await this.assetsService.findOwned(requesterIdOf(req), id);
		return this.assetsService.remove(id, String(asset.portfolioId));
	}
}
