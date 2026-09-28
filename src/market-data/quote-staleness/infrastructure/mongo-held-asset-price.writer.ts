import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { HeldAssetPriceWriter } from '../application/ports/held-asset-price.port';
import {
	QuoteFreshnessRecord,
	normalizeSymbol,
} from '../domain/quote-freshness';

/** Renda fixa e "outros" não têm cotação de mercado. */
const NO_MARKET_QUOTE_TYPES = ['fund', 'other'];

@Injectable()
export class MongoHeldAssetPriceWriter implements HeldAssetPriceWriter {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	async applyLatestPrices(records: QuoteFreshnessRecord[]): Promise<number> {
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
						type: { $nin: NO_MARKET_QUOTE_TYPES },
					},
					update: {
						$set: {
							currentPrice: record.lastPrice,
							currentPriceAt: new Date(record.lastQuoteAt),
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
}
