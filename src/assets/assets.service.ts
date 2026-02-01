import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { Asset } from 'src/assets/schema/assets.model';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';

@Injectable()
export class AssetsService {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@Inject(forwardRef(() => PortfolioService))
		private readonly portfolioModel: Model<Portfolio>
	) {}

	// Buscar todos os assets
	async findAll() {
		return this.assetModel.find();
	}

	// Buscar asset específico
	async findOne(assetId: string) {
		return this.assetModel.findById(assetId);
	}

	async findPortfolioById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	// Criar asset
	async create(asset: CreateAssetDto) {
		return this.assetModel.create(asset);
	}

	// Atualizar asset
	async update(assetId: string, updateDto: UpdateAssetDto) {
		return this.assetModel.findByIdAndUpdate(
			assetId,
			{
				quantity: updateDto.quantity,
				price: updateDto.price,
				total: updateDto.quantity * updateDto.price,
				updatedAt: new Date(),
			},
			{ new: true }
		);
	}

	// Deletar asset
	async remove(assetId: string, portfolioId: string) {
		// Remove asset
		await this.assetModel.findByIdAndDelete(assetId);

		// Remove de portfolio
		await this.portfolioModel.findByIdAndUpdate(portfolioId, {
			$pull: { assets: assetId },
		});
	}
}
