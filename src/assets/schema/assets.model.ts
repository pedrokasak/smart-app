import { Schema, Document, model, Types } from 'mongoose';

export interface IAssetIndicators {
	dividendYield?: number;
	priceToEarnings?: number;
	roe?: number;
	marketCap?: number;
	volume?: number;
	pegRatio?: number;
	priceToBook?: number;
	currentYield?: number; // Para FIIs
	pvpRatio?: number; // Para FIIs
}

export interface Asset extends Document {
	portfolioId: Types.ObjectId;
	symbol: string;
	name?: string;
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';
	quantity: number;
	price: number; // Preço de entrada
	avgPrice?: number; // Preço médio/custo (quando conhecido)
	total: number; // quantity * price
	currentPrice?: number;
	change24h?: number;
	dividendHistory?: {
		date: Date;
		value: number;
		paymentType?: 'JCP' | 'DIVIDEND' | 'RENDIMENTO' | 'OTHER';
	}[];
	indicators?: IAssetIndicators;
	source: 'manual' | 'b3' | 'webscrape';
	lastEnrichedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export const assetSchema = new Schema<Asset>(
	{
		portfolioId: {
			type: Schema.Types.ObjectId,
			ref: 'Portfolio',
			required: true,
			index: true,
		},
		symbol: {
			type: String,
			required: true,
			uppercase: true,
			trim: true,
		},
		name: {
			type: String,
			default: null,
			trim: true,
		},
		type: {
			type: String,
			enum: ['stock', 'fii', 'crypto', 'etf', 'fund', 'other'],
			required: true,
		},
		quantity: {
			type: Number,
			required: true,
			min: 0,
		},
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		avgPrice: {
			type: Number,
			default: null,
			min: 0,
		},
		total: {
			type: Number,
			required: true,
			min: 0,
		},
		currentPrice: {
			type: Number,
			default: null,
		},
		change24h: {
			type: Number,
			default: null,
		},
		dividendHistory: [
			{
				date: { type: Date, required: true },
				value: { type: Number, required: true, min: 0 },
				paymentType: {
					type: String,
					enum: ['JCP', 'DIVIDEND', 'RENDIMENTO', 'OTHER'],
					default: 'DIVIDEND',
				},
			},
		],
		indicators: {
			dividendYield: { type: Number, default: null },
			priceToEarnings: { type: Number, default: null },
			roe: { type: Number, default: null },
			marketCap: { type: Number, default: null },
			volume: { type: Number, default: null },
			pegRatio: { type: Number, default: null },
			priceToBook: { type: Number, default: null },
			currentYield: { type: Number, default: null },
			pvpRatio: { type: Number, default: null },
		},
		source: {
			type: String,
			enum: ['manual', 'b3', 'webscrape'],
			default: 'manual',
		},
		lastEnrichedAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	}
);

// Índices
assetSchema.index({ portfolioId: 1, symbol: 1 });
assetSchema.index({ createdAt: -1 });
assetSchema.index({ symbol: 1 });

assetSchema.set('toJSON', { virtuals: true });
assetSchema.set('toObject', { virtuals: true });

export const AssetModel = model<Asset>('Asset', assetSchema);
