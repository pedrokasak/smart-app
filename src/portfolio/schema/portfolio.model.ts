import { model, ObjectId, Schema } from 'mongoose';

export interface Portfolio extends Document {
	id: ObjectId;
	userId: ObjectId; // ← Dono
	cpf: string; // CPF para sincronização B3
	name: string; // "Minha Carteira" ou "Carteira do Filho"
	description?: string; // Descrição
	ownerType: 'self' | 'spouse' | 'child' | 'other'; // ← Tipo de carteira
	ownerName?: string; // Se for outra pessoa

	assets: ObjectId[]; // Referência para Assets

	totalValue: number;
	plan: 'free' | 'premium' | 'pro';

	createdAt: Date;
	updatedAt: Date;
	syncedWithB3At?: Date;
}

export const portfolioSchema = new Schema<Portfolio>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		cpf: {
			type: String,
			required: true,
			match: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/,
		},
		name: {
			type: String,
			required: true,
			trim: true,
			minlength: 3,
			maxlength: 100,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 500,
		},
		ownerType: {
			type: String,
			enum: ['self', 'spouse', 'child', 'other'],
			default: 'self',
		},
		ownerName: {
			type: String,
			trim: true,
		},
		assets: [
			{
				type: Schema.Types.ObjectId,
				ref: 'Asset',
			},
		],
		totalValue: {
			type: Number,
			default: 0,
			min: 0,
		},
		plan: {
			type: String,
			enum: ['free', 'premium', 'pro'],
			default: 'free',
		},
		syncedWithB3At: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	}
);

portfolioSchema.index({ userId: 1, createdAt: -1 });
portfolioSchema.index({ cpf: 1 });
portfolioSchema.index({ userId: 1, name: 1 });

portfolioSchema.set('toJSON', { virtuals: true });
portfolioSchema.set('toObject', { virtuals: true });

export const PortfolioModel = model<Portfolio>('Portfolio', portfolioSchema);
