import { Schema, model } from 'mongoose';

/**
 * Texto extraido de documentos de RI (TRA-253). Chave de
 * `riDocumentTextKey`; valor e o texto do PDF como a extracao devolveu.
 *
 * Documento publico da CVM ou do site de RI: nenhum dado de usuario aqui.
 */
export interface RiDocumentTextDocument {
	key: string;
	text: string;
	/** `null` = nao expira. O indice TTL ignora documento sem data. */
	expiresAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const riDocumentTextSchema = new Schema<RiDocumentTextDocument>(
	{
		key: { type: String, required: true },
		text: { type: String, required: true },
		expiresAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: 'ri_document_texts', minimize: false }
);

riDocumentTextSchema.index(
	{ key: 1 },
	{ unique: true, name: 'ri_document_text_key' }
);
// O Mongo apaga o documento quando `expiresAt` passa (varredura a cada ~60s).
riDocumentTextSchema.index(
	{ expiresAt: 1 },
	{ expireAfterSeconds: 0, name: 'ri_document_text_ttl' }
);

export const RiDocumentTextModel = model<RiDocumentTextDocument>(
	'RiDocumentText',
	riDocumentTextSchema
);
