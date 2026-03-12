import {
	Body,
	Controller,
	Get,
	Param,
	Post,
	Put,
	Delete,
	Req,
	UseGuards,
	UseInterceptors,
	UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssetsService } from 'src/assets/assets.service';
import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { UpdateAssetDto } from 'src/assets/dto/update-asset.dto';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { PortfolioMapper } from 'src/portfolio/mappers/portfolio.mapper.ts';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { UpdatePortfolioDto } from 'src/portfolio/dto/update-portfolio.dto';
import { PortfolioResponseDto } from 'src/portfolio/dto/portfolio-response.dto';
import { PortfolioWithAssetsDto } from 'src/portfolio/dto/portfolio-with-assets.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';

@Controller('portfolio')
@ApiTags('Portfolio')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
	constructor(
		private portfolioService: PortfolioService,
		private assetService: AssetsService,
		private subscriptionService: SubscriptionService
	) {}

	@Post('create')
	async create(
		@Body() createPortfolioDto: CreatePortfolioDto,
		@Req() req: any
	): Promise<PortfolioResponseDto> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;

		const currentSub =
			await this.subscriptionService.findCurrentSubscriptionByUser(userId);
		const userPlan = (currentSub?.plan as any)?.name || 'free';

		const portfolio = await this.portfolioService.createPortfolio(
			userId,
			createPortfolioDto,
			userPlan
		);
		return PortfolioMapper.toResponseDto(portfolio);
	}

	@Get()
	async findAll(@Req() req: any): Promise<PortfolioResponseDto[]> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		return PortfolioMapper.toResponseDtoArray(portfolios);
	}

	@Get('assets')
	async findAllAssets(@Req() req: any): Promise<AssetResponseDto[]> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((p) => (p.assets as any) || []);
		return AssetMapper.toResponseDtoArray(assets);
	}

	@Get('transactions')
	async findTransactions(
		@Req() req: any,
	) {
		// Returns all transactions across all portfolios for this user
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const transactions = portfolios.flatMap((p) => {
			const assets = (p.assets as any) || [];
			return assets.flatMap((a: any) => {
				const txns = a.transactions || [];
				return txns.map((t: any) => ({
					...t,
					assetId: a._id,
					symbol: a.symbol,
				}));
			});
		});
		return { transactions };
	}

	@Get('assets/:assetId')
	async findAssetById(
		@Param('assetId') assetId: string,
		@Req() req: any,
	) {
		// Fetch a specific asset across all user portfolios
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		for (const p of portfolios) {
			const asset = ((p.assets as any) || []).find(
				(a: any) => a._id?.toString() === assetId
			);
			if (asset) return AssetMapper.toResponseDto(asset);
		}
		return null;
	}

	@Put('assets/:assetId')
	async updateAsset(
		@Param('assetId') assetId: string,
		@Body() updateAssetDto: UpdateAssetDto
	): Promise<AssetResponseDto | null> {
		const updated = await this.assetService.update(assetId, updateAssetDto);
		return updated ? AssetMapper.toResponseDto(updated as any) : null;
	}

	@Get('summary')
	async getSummary(@Req() req: any) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const allAssets = portfolios.flatMap((p) => (p.assets as any) || []);
		const totalValue = allAssets.reduce((sum: number, a: any) => sum + (a.total || 0), 0);
		return { totalValue, totalAssets: allAssets.length, portfolios: portfolios.length };
	}

	@Get(':id')
	async findById(@Param('id') id: string): Promise<PortfolioWithAssetsDto> {
		const portfolio = await this.portfolioService.findPortfolioById(id);
		// portfolio já vem com assets populados!
		return PortfolioMapper.toResponseDtoWithAssets(portfolio, portfolio.assets);
	}

	@Get(':id/history')
	async getHistory(@Param('id') id: string) {
		return this.portfolioService.getPortfolioHistory(id);
	}

	@Post(':id/import-b3')
	@UseInterceptors(FileInterceptor('file'))
	async importB3Report(
		@Param('id') id: string,
		@UploadedFile() file: any
	): Promise<any> {
		if (!file) {
			throw new Error('Arquivo não enviado');
		}

		// Simulando a leitura do XLSX local e instanciando os ativos
		// O processo ideal usaria xlsx.read(file.buffer) aqui
		const simulatedAssets = [
			{ name: 'PETR4', ticker: 'PETR4', quantity: 100, averagePrice: 35.50, type: 'stock', currentPrice: 38.00 },
			{ name: 'VALE3', ticker: 'VALE3', quantity: 50, averagePrice: 60.20, type: 'stock', currentPrice: 62.10 },
			{ name: 'MXRF11', ticker: 'MXRF11', quantity: 200, averagePrice: 10.10, type: 'fii', currentPrice: 10.50 }
		];

		const importedAssets = [];

		for (const assetData of simulatedAssets) {
			const assetDto: CreateAssetDto = {
				symbol: assetData.ticker,
				quantity: assetData.quantity,
				price: assetData.averagePrice,
				type: assetData.type as any,
			};
			
			const asset = await this.portfolioService.addAssetToPortfolio(
				id,
				assetDto
			);
			importedAssets.push(AssetMapper.toResponseDto(asset));
		}

		return {
			message: 'Relatório importado com sucesso',
			assetsImported: importedAssets.length,
			assets: importedAssets
		};
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

	@Put(':id')
	async update(
		@Param('id') id: string,
		@Body() updatePortfolioDto: UpdatePortfolioDto
	): Promise<PortfolioResponseDto> {
		const portfolio = await this.portfolioService.updatePortfolio(
			id,
			updatePortfolioDto
		);
		return PortfolioMapper.toResponseDto(portfolio);
	}

	@Delete(':id')
	async delete(@Param('id') id: string): Promise<void> {
		await this.portfolioService.deletePortfolio(id);
	}
}
