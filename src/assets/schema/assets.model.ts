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
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund';
	quantity: number;
	price: number; // Preço de entrada
	total: number; // quantity * price
	currentPrice?: number;
	change24h?: number;
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
		type: {
			type: String,
			enum: ['stock', 'fii', 'crypto', 'etf', 'fund'],
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
