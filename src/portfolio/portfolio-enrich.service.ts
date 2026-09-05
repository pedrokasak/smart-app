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

	/**
	 * Enriquece um asset com web scraping.
	 *
	 * TODO(TRA-136): `lastEnrichedAt`, gravado aqui, e o carimbo de tempo de
	 * mercado mais proximo que existe hoje — mas ele marca o enriquecimento
	 * do ativo, nao a ultima cotacao, e nao ha job periodico que o renove.
	 * Enquanto nao houver um refresh agendado (ou um `asOf` vindo do
	 * provider), o evento `market.quote.stale` fica sem produtor. Ver a nota
	 * em `src/events/domain/event-types.ts`.
	 */
	async enrichAsset(asset: any) {
		try {
			if (asset.type === 'other') return asset;

			// Usa o tipo já definido quando disponível para evitar sobrescrever (ex: ETF)
			const assetType =
				asset.type && asset.type !== 'other'
					? asset.type
					: this.assetAdapterFactory.detectAssetType(asset.symbol);

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
