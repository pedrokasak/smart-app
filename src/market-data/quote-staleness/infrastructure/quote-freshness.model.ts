import { Schema, Types, model } from 'mongoose';

/**
 * Carimbo da ultima leitura de cotacao por simbolo (TRA-136, fase 7).
 *
 * Colecao nova, e nao um campo em `Asset`: o frescor e do SIMBOLO, nao da
 * posicao. Dez usuarios com PETR4 compartilham a mesma leitura; guardar em
 * Asset gravaria dez vezes o mesmo carimbo a cada varredura e ainda faria a
 * varredura escrever no documento mais quente da carteira.
 *
 * Nada aqui e fonte de verdade de negocio — o dado e integralmente
 * regeneravel pela proxima varredura. Perder a colecao custa, no maximo,
 * um ciclo de silencio.
 */
export interface QuoteFreshnessDocument {
	_id?: Types.ObjectId;
	symbol: string;
	lastQuoteAt: Date;
	lastPrice?: number | null;
	source?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const quoteFreshnessSchema = new Schema<QuoteFreshnessDocument>(
	{
		symbol: {
			type: String,
			required: true,
			uppercase: true,
			trim: true,
			unique: true,
		},
		lastQuoteAt: { type: Date, required: true },
		lastPrice: { type: Number, default: null },
		source: { type: String, default: null },
	},
	{ timestamps: true, collection: 'quote_freshness' }
);

export const QuoteFreshnessModel = model<QuoteFreshnessDocument>(
	'QuoteFreshness',
	quoteFreshnessSchema
);
