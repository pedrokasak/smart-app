import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { HeldSymbol, HeldSymbolsReader } from '../application/ports';

/** Só o que tem cotação na bolsa: cripto e fundos têm outra fonte. */
const LISTED_TYPES = ['stock', 'fii', 'etf'];

@Injectable()
export class MongoHeldSymbolsReader implements HeldSymbolsReader {
	constructor(
		@InjectModel('Asset') private readonly assets: Model<Asset>,
		@InjectModel('Trade') private readonly trades: Model<any>
	) {}

	async list(): Promise<HeldSymbol[]> {
		const [symbols, firstTrades] = await Promise.all([
			this.assets.distinct('symbol', { type: { $in: LISTED_TYPES } }),
			this.trades.aggregate<{ _id: string; since: Date }>([
				{ $group: { _id: '$symbol', since: { $min: '$date' } } },
			]),
		]);

		const since = new Map(
			firstTrades.map((row) => [String(row._id).toUpperCase(), row.since])
		);
		const unique = [
			...new Set(symbols.map((symbol) => String(symbol).toUpperCase())),
		].filter(Boolean);
		return unique.map((symbol) => ({
			symbol,
			since: since.get(symbol) ?? null,
		}));
	}
}
