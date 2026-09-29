import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { HeldTickerDirectory } from 'src/ri-intelligence/watch/application/ports/held-ticker-directory.port';

function normalizeTicker(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toUpperCase()
		.replace(/\.SA$/, '');
}

/** Tickers em carteira a partir das posicoes (TRA-240). */
@Injectable()
export class MongoHeldTickerDirectory implements HeldTickerDirectory {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	async heldStockTickers(): Promise<string[]> {
		const raw: unknown[] = await this.assetModel
			.distinct('symbol', { quantity: { $gt: 0 }, type: 'stock' })
			.exec();
		return Array.from(new Set(raw.map(normalizeTicker).filter(Boolean))).sort();
	}
}
