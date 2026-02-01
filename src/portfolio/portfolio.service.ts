import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { Asset } from 'src/assets/schema/assets.model';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { PortfolioEnrichService } from 'src/portfolio/portfolio-enrich.service';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';

@Injectable()
export class PortfolioService {
	constructor(
		@InjectModel('Portfolio') private portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private assetModel: Model<Asset>,
		private portfolioEnrichService: PortfolioEnrichService
	) {}

	async findPortfolioById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	// Buscar portfolio com todos os assets
	async getPortfolioWithAssets(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	// Buscar todas as carteiras do usuário
	async getUserPortfolios(userId: string) {
		return this.portfolioModel.find({ userId }).populate('assets');
	}

	// Buscar carteira especifica
	async findById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId);
	}

	// Criar carteira (pode ser de outro membro da família)
	async createPortfolio(userId: string, createDto: CreatePortfolioDto) {
		const portfolio = await this.portfolioModel.create({
			userId,
			name: createDto.name,
			ownerType: createDto.ownerType, // 'self', 'spouse', 'child'
			ownerName: createDto.ownerName,
			cpf: createDto.cpf,
			assets: [],
			plan: createDto.plan,
		});

		return portfolio;
	}

	// Adicionar asset manual a uma carteira específica
	async addAssetToPortfolio(
		portfolioId: string,
		createAssetDto: CreateAssetDto
	) {
		// 1. Cria asset
		const asset = await this.assetModel.create({
			portfolioId,
			symbol: createAssetDto.symbol,
			quantity: createAssetDto.quantity,
			price: createAssetDto.price,
			total: createAssetDto.quantity * createAssetDto.price,
			source: 'manual',
		});

		// 2. Enriquece com web scraping
		const enriched = await this.portfolioEnrichService.enrichAsset(asset);

		// 3. Adiciona à carteira
		await this.portfolioModel.findByIdAndUpdate(portfolioId, {
			$push: { assets: enriched._id },
		});

		return enriched;
	}
}
