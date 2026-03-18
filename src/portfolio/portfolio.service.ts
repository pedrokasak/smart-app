import {
	Injectable,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { Asset } from 'src/assets/schema/assets.model';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { UpdatePortfolioDto } from 'src/portfolio/dto/update-portfolio.dto';
import { PortfolioEnrichService } from 'src/portfolio/portfolio-enrich.service';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';

@Injectable()
export class PortfolioService {
	constructor(
		@InjectModel('Portfolio') private portfolioModel: Model<Portfolio>,
		@InjectModel('PortfolioHistory')
		private portfolioHistoryModel: Model<PortfolioHistory>,
		@InjectModel('Asset') private assetModel: Model<Asset>,
		private portfolioEnrichService: PortfolioEnrichService
	) {}

	async findPortfolioById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	async getPortfolioHistory(portfolioId: string) {
		return this.portfolioHistoryModel
			.find({ portfolioId })
			.sort({ date: 1 })
			.exec();
	}

	async recordHistorySnapshot(portfolioId: string) {
		const portfolio = await this.portfolioModel
			.findById(portfolioId)
			.populate('assets');
		if (!portfolio) return;

		const assets = portfolio.assets as unknown as Asset[];
		const totalValue = assets.reduce(
			(acc, asset) => acc + (asset.total || 0),
			0
		);

		const today = new Date().toISOString().split('T')[0];

		await this.portfolioHistoryModel.findOneAndUpdate(
			{ portfolioId, date: today },
			{
				userId: portfolio.userId,
				totalValue,
			},
			{ upsert: true, new: true }
		);
	}

	async getPortfolioWithAssets(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	async getUserPortfolios(userId: string) {
		return this.portfolioModel.find({ userId }).populate('assets');
	}

	async findPortfolioByName(userId: string, name: string) {
		return this.portfolioModel
			.findOne({ userId, name: new RegExp(`^${name}$`, 'i') })
			.populate('assets');
	}

	async findById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId);
	}

	async createPortfolio(
		userId: string,
		createDto: CreatePortfolioDto,
		userPlan: string = 'free'
	) {
		const existingPortfoliosCount = await this.portfolioModel.countDocuments({
			userId,
		});

		if (userPlan === 'free' && existingPortfoliosCount >= 1) {
			throw new ForbiddenException(
				'Limite de portfólios atingido. Faça upgrade para o plano Premium para criar mais portfólios.'
			);
		}

		const portfolio = await this.portfolioModel.create({
			userId,
			name: createDto.name,
			ownerType: createDto.ownerType, // 'self', 'spouse', 'child'
			ownerName: createDto.ownerName,
			cpf: createDto.cpf ?? null,
			assets: [],
			plan: userPlan,
		});

		return portfolio;
	}

	async addAssetToPortfolio(
		portfolioId: string,
		createAssetDto: CreateAssetDto,
		source: 'manual' | 'b3' | 'webscrape' = 'manual'
	) {
		const asset = await this.assetModel.create({
			portfolioId,
			symbol: createAssetDto.symbol,
			type: createAssetDto.type,
			quantity: createAssetDto.quantity,
			price: createAssetDto.price,
			total: createAssetDto.quantity * createAssetDto.price,
			source,
		});

		const enriched = await this.portfolioEnrichService.enrichAsset(asset);

		await this.portfolioModel.findByIdAndUpdate(portfolioId, {
			$push: { assets: enriched._id },
		});

		await this.recordHistorySnapshot(portfolioId);

		return enriched;
	}

	async updatePortfolio(portfolioId: string, updateDto: UpdatePortfolioDto) {
		const updatedPortfolio = await this.portfolioModel.findByIdAndUpdate(
			portfolioId,
			updateDto,
			{ new: true }
		);

		if (!updatedPortfolio) {
			throw new NotFoundException('Portfólio não encontrado.');
		}

		return updatedPortfolio;
	}

	async deletePortfolio(portfolioId: string) {
		const deletedPortfolio =
			await this.portfolioModel.findByIdAndDelete(portfolioId);

		if (!deletedPortfolio) {
			throw new NotFoundException('Portfólio não encontrado.');
		}

		return deletedPortfolio;
	}
}
