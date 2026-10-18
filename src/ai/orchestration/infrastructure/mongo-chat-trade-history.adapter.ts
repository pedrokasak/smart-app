import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { TradeDocument } from 'src/fiscal/schema/trade.model';
import {
	ChatTradeHistoryPort,
	MAX_TRADES_READ,
} from 'src/ai/orchestration/trade-history/chat-trade-history.port';
import type { TradeHistoryQuery } from 'src/ai/orchestration/trade-history/trade-history.query';
import type { TradeRow } from 'src/ai/orchestration/trade-history/trade-history.summary';

@Injectable()
export class MongoChatTradeHistoryAdapter implements ChatTradeHistoryPort {
	constructor(
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>
	) {}

	async listTrades(
		userId: string,
		query: TradeHistoryQuery
	): Promise<TradeRow[]> {
		if (!Types.ObjectId.isValid(userId)) return [];

		const filter: Record<string, unknown> = {
			userId: new Types.ObjectId(userId),
		};
		if (query.symbol) filter.symbol = query.symbol.toUpperCase();
		if (query.side) filter.side = query.side;
		if (query.from || query.to) {
			filter.date = {
				...(query.from
					? { $gte: new Date(`${query.from}T00:00:00.000Z`) }
					: {}),
				...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
			};
		}

		const docs = await this.tradeModel
			.find(filter)
			.select('symbol side quantity price fees date')
			.sort({ date: -1 })
			.limit(MAX_TRADES_READ)
			.lean();
		return docs.map((doc) => ({
			symbol: doc.symbol,
			side: doc.side,
			quantity: doc.quantity,
			price: doc.price,
			fees: doc.fees ?? 0,
			date: doc.date,
		}));
	}
}
