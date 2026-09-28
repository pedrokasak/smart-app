import { Schema, model } from 'mongoose';

/**
 * Cache persistente do resumo de documento de RI (TRA-238).
 *
 * O cache em memoria sumia a cada deploy e nao era compartilhado entre
 * instancias: o mesmo release seria resumido de novo por processo. A chave
 * e a de `RiDocumentSummaryService.buildCacheKey` (documento + hash do
 * conteudo + versao), e o valor e o `RiDocumentSummaryOutput` inteiro.
 *
 * Documento publico, nao dado de usuario: nenhum campo pessoal aqui.
 */
export interface RiSummaryCacheDocument {
	key: string;
	value: unknown;
	/** `null` = nao expira. O indice TTL ignora documento sem data. */
	expiresAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const riSummaryCacheSchema = new Schema<RiSummaryCacheDocument>(
	{
		key: { type: String, required: true },
		value: { type: Schema.Types.Mixed, required: true },
		expiresAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: 'ri_summary_cache', minimize: false }
);

riSummaryCacheSchema.index(
	{ key: 1 },
	{ unique: true, name: 'ri_summary_cache_key' }
);
// O Mongo apaga o documento quando `expiresAt` passa (varredura a cada ~60s).
riSummaryCacheSchema.index(
	{ expiresAt: 1 },
	{ expireAfterSeconds: 0, name: 'ri_summary_cache_ttl' }
);

export const RiSummaryCacheModel = model<RiSummaryCacheDocument>(
	'RiSummaryCache',
	riSummaryCacheSchema
);
