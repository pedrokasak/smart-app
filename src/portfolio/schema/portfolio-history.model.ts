import { model, ObjectId, Schema } from 'mongoose';

export interface PortfolioHistory extends Document {
	portfolioId: ObjectId;
	userId: ObjectId;
	date: string; // Formato YYYY-MM-DD para o dia correspondente
	/** Posição a preço de mercado no dia. */
	totalValue: number;
	/**
	 * Custo de aquisição acumulado. Até TRA-143 este número ocupava o lugar de
	 * `totalValue` — o snapshot somava `asset.total`, que é quantity * custo, e
	 * por isso a série saía reta. Separados, a diferença entre os dois é
	 * retorno não realizado.
	 */
	investedValue?: number;
	/** true quando algum ativo caiu para o custo por falta de cotação. */
	stale?: boolean;
	/** Símbolos sem cotação no momento do snapshot. */
	staleSymbols?: string[];
	/**
	 * false em fim de semana e feriado. O snapshot roda todo dia, e nesses dias
	 * a cotação não muda — incluí-los em volatilidade ou retorno dilui a
	 * variação por construção (um mês de 30 pontos com ~21 pregões).
	 */
	tradingDay?: boolean;
	/** Por que não houve pregão, quando `tradingDay` é false. */
	nonTradingReason?: 'weekend' | 'holiday';
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
		// Opcionais para não invalidar os snapshots já gravados (CLAUDE.md §9).
		// Ausência significa "snapshot anterior a TRA-143", que é informação
		// útil: aqueles pontos são custo, não valor de mercado.
		investedValue: {
			type: Number,
			required: false,
			min: 0,
		},
		stale: {
			type: Boolean,
			required: false,
		},
		staleSymbols: {
			type: [String],
			required: false,
			default: undefined,
		},
		tradingDay: {
			type: Boolean,
			required: false,
		},
		nonTradingReason: {
			type: String,
			enum: ['weekend', 'holiday'],
			required: false,
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
