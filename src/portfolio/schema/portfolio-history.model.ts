import { model, ObjectId, Schema } from 'mongoose';

export interface PortfolioHistory extends Document {
	portfolioId: ObjectId;
	userId: ObjectId;
	date: string; // Formato YYYY-MM-DD para o dia correspondente
	totalValue: number;
	createdAt: Date;
	updatedAt: Date;
}

export const portfolioHistorySchema = new Schema<PortfolioHistory>(
	{
		portfolioId: {
			type: Schema.Types.ObjectId,
			ref: 'Portfolio',
			required: true,
			index: true,
		},
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		date: {
			type: String,
			required: true,
		},
		totalValue: {
			type: Number,
			required: true,
			min: 0,
		},
	},
	{
		timestamps: true,
	}
);

// Índice composto para garantir que só teremos um snapshot por dia por carteira
portfolioHistorySchema.index({ portfolioId: 1, date: 1 }, { unique: true });

export const PortfolioHistoryModel = model<PortfolioHistory>(
	'PortfolioHistory',
	portfolioHistorySchema
);
