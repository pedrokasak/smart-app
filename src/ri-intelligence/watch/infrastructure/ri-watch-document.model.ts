import { Schema, model } from 'mongoose';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	RiWatchStatus,
	RiWatchSummarySnapshot,
} from 'src/ri-intelligence/watch/domain/ri-watch';

/**
 * Documentos vistos pelo vigia de RI (TRA-240).
 *
 * Um documento por identidade (`key`, unico; ver `watchDocumentKey`): o
 * protocolo de entrega da CVM, que o ENET diario e o IPE semanal
 * compartilham (TRA-260), ou o link de download para documento sem
 * protocolo. E isso que torna a varredura idempotente, com qualquer das
 * duas fontes. Documento publico da CVM, sem dado de usuario —
 * quem sera avisado sai das carteiras na hora de notificar, nao fica aqui.
 */
export interface RiWatchDocumentSchema {
	key: string;
	ticker: string;
	documentType: RiDocumentRecord['documentType'];
	publishedAt: Date;
	record: RiDocumentRecord;
	status: RiWatchStatus;
	attempts: number;
	discoveredAt: Date;
	processedAt: Date | null;
	lastError: string | null;
	summary: RiWatchSummarySnapshot | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const riWatchDocumentSchema = new Schema<RiWatchDocumentSchema>(
	{
		key: { type: String, required: true },
		ticker: { type: String, required: true },
		documentType: { type: String, required: true },
		publishedAt: { type: Date, required: true },
		record: { type: Schema.Types.Mixed, required: true },
		status: {
			type: String,
			required: true,
			enum: ['pending', 'summarized', 'skipped', 'failed'],
			default: 'pending',
		},
		attempts: { type: Number, required: true, default: 0 },
		discoveredAt: { type: Date, required: true },
		processedAt: { type: Date, default: null },
		lastError: { type: String, default: null },
		summary: { type: Schema.Types.Mixed, default: null },
	},
	{ timestamps: true, collection: 'ri_watch_documents', minimize: false }
);

riWatchDocumentSchema.index(
	{ key: 1 },
	{ unique: true, name: 'ri_watch_document_key' }
);
// A fila: pendentes, mais recentes primeiro.
riWatchDocumentSchema.index(
	{ status: 1, publishedAt: -1 },
	{ name: 'ri_watch_pending' }
);

export const RiWatchDocumentModel = model<RiWatchDocumentSchema>(
	'RiWatchDocument',
	riWatchDocumentSchema
);
