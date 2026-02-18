import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssetsService } from 'src/assets/assets.service';
import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { PortfolioMapper } from 'src/portfolio/mappers/portfolio.mapper.ts';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { PortfolioResponseDto } from 'src/portfolio/dto/portfolio-response.dto';
import { PortfolioWithAssetsDto } from 'src/portfolio/dto/portfolio-with-assets.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';

@Controller('portfolio')
@ApiTags('Portfolio')
@ApiBearerAuth('access-token')
export class PortfolioController {
	constructor(
		private portfolioService: PortfolioService,
		private assetService: AssetsService
	) {}

	@Post()
	async create(
		@Body() createPortfolioDto: CreatePortfolioDto,
		@Req() req: any
	): Promise<PortfolioResponseDto> {
		const portfolio = await this.portfolioService.createPortfolio(
			req.user.id,
			createPortfolioDto
		);
		return PortfolioMapper.toResponseDto(portfolio);
	}

	@Get()
	async findAll(@Req() req: any): Promise<PortfolioResponseDto[]> {
		const portfolios = await this.portfolioService.getUserPortfolios(
			req.user.id
		);
		return PortfolioMapper.toResponseDtoArray(portfolios);
	}

	@Get(':id')
	async findById(@Param('id') id: string): Promise<PortfolioWithAssetsDto> {
		const portfolio = await this.portfolioService.findPortfolioById(id);
		// portfolio já vem com assets populados!
		return PortfolioMapper.toResponseDtoWithAssets(portfolio, portfolio.assets);
	}
	@Post(':portfolioId/asset')
	async addAsset(
		@Param('portfolioId') portfolioId: string,
		@Body() createAssetDto: CreateAssetDto
	): Promise<AssetResponseDto> {
		const asset = await this.portfolioService.addAssetToPortfolio(
			portfolioId,
			createAssetDto
		);
		return AssetMapper.toResponseDto(asset);
	}
}
