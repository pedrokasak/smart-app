import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { HeldAssetPriceWriter } from '../application/ports/held-asset-price.port';
import {
	QuoteFreshnessRecord,
	normalizeSymbol,
} from '../domain/quote-freshness';
import { QuoteKind, assetTypesFor } from '../domain/quote-kind';

@Injectable()
export class MongoHeldAssetPriceWriter implements HeldAssetPriceWriter {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	async applyLatestPrices(
		records: QuoteFreshnessRecord[],
		kind: QuoteKind
	): Promise<number> {
		const types = [...assetTypesFor(kind)];
		const operations = records
			.filter(
				(record) =>
					typeof record.lastPrice === 'number' &&
					Number.isFinite(record.lastPrice) &&
					record.lastPrice > 0 &&
					!!normalizeSymbol(record.symbol)
			)
			.map((record) => ({
				updateMany: {
					filter: {
						symbol: normalizeSymbol(record.symbol),
						type: { $in: types },
					},
					update: {
						$set: {
							currentPrice: record.lastPrice,
							currentPriceAt: new Date(record.lastQuoteAt),
							currentPriceSource: record.source ?? kind,
						},
					},
				},
			}));

		if (operations.length === 0) return 0;

		const result = await this.assetModel.bulkWrite(operations as any, {
			ordered: false,
		});
		return Number(result?.modifiedCount) || 0;
	}

	async clearMisquotedCrypto(pricedSymbols: string[]): Promise<number> {
		// Só o que a gravação de ontem escreveu (tem `currentPriceAt`) e que
		// não veio da CoinGecko. Preço de cripto gravado por outro caminho
		// (importação, corretora) fica intacto.
		const result = await this.assetModel.updateMany(
			{
				type: 'crypto',
				currentPriceAt: { $exists: true },
				currentPriceSource: { $ne: 'coingecko' },
				symbol: { $nin: pricedSymbols.map(normalizeSymbol) },
			},
			{
				$set: { currentPrice: null },
				$unset: { currentPriceAt: '', currentPriceSource: '' },
			}
		);
		return Number(result?.modifiedCount) || 0;
	}
}
