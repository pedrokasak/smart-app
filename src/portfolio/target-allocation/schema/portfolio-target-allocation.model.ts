import { Schema, Document, model, Types } from 'mongoose';

/**
 * Meta de alocação-alvo do portfólio, por usuário (TRA-68).
 *
 * Um documento por usuário (`unique: true` em `user`), no mesmo padrão de
 * `src/profile`. Antes disso a meta só existia no `localStorage` do
 * navegador (`portfolio_target_allocation` em `web/src/pages/Index.tsx`),
 * nunca era escrita por nenhuma tela e por isso ficava sempre vazia.
 */
export interface PortfolioTargetAllocation extends Document {
	user: Types.ObjectId;

	stocks?: number;
	crypto?: number;
	fiis?: number;
	other?: number;

	createdAt: Date;
	updatedAt: Date;
}

const portfolioTargetAllocationSchema = new Schema<PortfolioTargetAllocation>(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
		},

		stocks: { type: Number, min: 0, max: 100 },
		crypto: { type: Number, min: 0, max: 100 },
		fiis: { type: Number, min: 0, max: 100 },
		other: { type: Number, min: 0, max: 100 },
	},
	{
		timestamps: true,
	}
);

portfolioTargetAllocationSchema.index({ user: 1 });

portfolioTargetAllocationSchema.set('toJSON', { virtuals: true });
portfolioTargetAllocationSchema.set('toObject', { virtuals: true });

export const PortfolioTargetAllocationModel = model<PortfolioTargetAllocation>(
	'PortfolioTargetAllocation',
	portfolioTargetAllocationSchema
);
