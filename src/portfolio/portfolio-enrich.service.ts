import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { AssetAdapterFactory } from 'src/portfolio/adapter/asset-adapter.factory';

@Injectable()
export class PortfolioEnrichService {
	constructor(
		private assetAdapterFactory: AssetAdapterFactory,
		@InjectModel('Asset') private assetModel: Model<Asset>,
		@InjectModel('Portfolio') private portfolioModel: Model<Portfolio>
	) {}

	// Enriquece um asset com web scraping
	async enrichAsset(asset: any) {
		try {
			// Detecta tipo
			const assetType = this.assetAdapterFactory.detectAssetType(asset.symbol);

			// Pega adapter apropriado
			const adapter = this.assetAdapterFactory.getAdapter(assetType);

			// Web scrape dos indicadores
			const indicators = await adapter.getIndicators(asset.symbol);

			// Atualiza asset
			const enriched = await this.assetModel.findByIdAndUpdate(
				asset._id,
				{
					type: assetType,
					currentPrice: indicators.price,
					change24h: indicators.changePercent,
					indicators: indicators.indicators,
					lastEnrichedAt: new Date(),
				},
				{ new: true }
			);

			return enriched;
		} catch (error) {
			console.error(`Erro ao enriquecer ${asset.symbol}:`, error);
			return asset; // Retorna sem enriquecimento se falhar
		}
	}

	// Enriquece toda uma portfolio
	async enrichPortfolio(portfolioId: string) {
		const portfolio = await this.portfolioModel
			.findById(portfolioId)
			.populate('assets');

		const enrichedAssets = await Promise.all(
			portfolio.assets.map((asset) => this.enrichAsset(asset))
		);

		return enrichedAssets;
	}
}
