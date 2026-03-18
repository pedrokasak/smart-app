import { Schema, model, Types, Document } from 'mongoose';

export type TradeSide = 'buy' | 'sell';

export interface TradeDocument extends Document {
	userId: Types.ObjectId;
	portfolioId?: Types.ObjectId;
	uploadId?: Types.ObjectId;
	provider: string;
	symbol: string;
	side: TradeSide;
	quantity: number;
	price: number;
	fees?: number;
	date: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

export const tradeSchema = new Schema<TradeDocument>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		portfolioId: {
			type: Schema.Types.ObjectId,
			ref: 'Portfolio',
			required: false,
			index: true,
		},
		uploadId: {
			type: Schema.Types.ObjectId,
			ref: 'BrokerageNoteUpload',
			required: false,
			index: true,
		},
		provider: { type: String, required: true, index: true },
		symbol: {
			type: String,
			required: true,
			uppercase: true,
			trim: true,
			index: true,
		},
		side: { type: String, enum: ['buy', 'sell'], required: true },
		quantity: { type: Number, required: true, min: 0.00000001 },
		price: { type: Number, required: true, min: 0 },
		fees: { type: Number, default: 0, min: 0 },
		date: { type: Date, required: true, index: true },
	},
	{ timestamps: true }
);

tradeSchema.index({ userId: 1, provider: 1, symbol: 1, date: 1 });

export const TradeModel = model<TradeDocument>('Trade', tradeSchema);
