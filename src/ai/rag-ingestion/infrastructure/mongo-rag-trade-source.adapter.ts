import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Trade } from 'src/fiscal/domain/trade';
import type { TradeDocument } from 'src/fiscal/schema/trade.model';
import { RagTradeSourcePort } from 'src/ai/rag-ingestion/application/rag-trade-source.port';

@Injectable()
export class MongoRagTradeSourceAdapter implements RagTradeSourcePort {
	constructor(
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>
	) {}

	async listTrades(userId: string): Promise<Trade[]> {
		if (!Types.ObjectId.isValid(userId)) return [];
		const docs = await this.tradeModel
			.find({ userId: new Types.ObjectId(userId) })
			.select('symbol side quantity price fees date')
			.sort({ date: 1 })
			.lean();
		return docs.map((doc) => ({
			assetSymbol: doc.symbol,
			side: doc.side,
			quantity: doc.quantity,
			price: doc.price,
			fees: doc.fees ?? 0,
			date: doc.date,
		}));
	}
}
