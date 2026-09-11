import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { AssetAdapterFactory } from 'src/portfolio/adapter/asset-adapter.factory';
import {
	MARKET_DATA_PROVIDER,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import {
	isSectorApplicable,
	resolveSectorForStorage,
} from 'src/portfolio/sector/sector';

@Injectable()
export class PortfolioEnrichService {
	private readonly logger = new Logger(PortfolioEnrichService.name);

	constructor(
		private assetAdapterFactory: AssetAdapterFactory,
		@InjectModel('Asset') private assetModel: Model<Asset>,
		@InjectModel('Portfolio') private portfolioModel: Model<Portfolio>,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	/**
	 * Setor do ativo, buscado SÓ quando ainda não há e o tipo tem setor
	 * (TRA-144). Setor quase nunca muda: buscar a cada enriquecimento seria
	 * uma chamada extra a uma fonte com limite de taxa sem ganho nenhum.
	 *
	 * Falha não derruba o enriquecimento, mas é registrada. O fiscal fazia a
	 * mesma busca com `catch {}` vazio e a falha virava "setor não
	 * identificado" exibido como se fosse dado.
	 */
	private async resolveMissingSector(
		asset: any,
		assetType: string
	): Promise<{ sector?: string }> {
		if (asset?.sector) return {};
		if (!isSectorApplicable(assetType)) return {};

		try {
			const snapshot = await this.marketData.getAssetSnapshot(asset.symbol);
			const sector = resolveSectorForStorage({
				assetType,
				snapshotSector: snapshot?.sector,
			});
			return sector ? { sector } : {};
		} catch (error: any) {
			this.logger.warn(
				`Setor de ${asset?.symbol} indisponível: ${error?.message || 'unknown_error'}`
			);
			return {};
		}
	}

	/**
	 * Enriquece um asset com web scraping.
	 *
	 * `lastEnrichedAt`, gravado aqui, marca o ENRIQUECIMENTO do ativo, nao a
	 * ultima cotacao — e continua assim de proposito. O sinal de frescor de
	 * cotacao que o `market.quote.stale` usa (TRA-136, fase 7) e outro,
	 * mora em `src/market-data/quote-staleness/` e e por SIMBOLO, nao por
	 * posicao: dez usuarios com PETR4 compartilham a mesma leitura. Nao
	 * confunda os dois carimbos ao ler este metodo.
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

			// Setor só quando falta e o tipo tem setor (TRA-144).
			const sectorUpdate = await this.resolveMissingSector(asset, assetType);

			// Atualiza asset
			const enriched = await this.assetModel.findByIdAndUpdate(
				asset._id,
				{
					type: assetType,
					currentPrice: indicators.price,
					change24h: indicators.changePercent,
					indicators: indicators.indicators,
					lastEnrichedAt: new Date(),
					...sectorUpdate,
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
