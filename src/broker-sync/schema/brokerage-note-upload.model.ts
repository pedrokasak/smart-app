import { Schema, model, Types, Document } from 'mongoose';

export type BrokerageNoteStatus =
	| 'received'
	| 'queued'
	| 'processing'
	| 'processed'
	| 'failed';

export type BrokerageUploadKind = 'brokerage_note' | 'b3_report' | 'unknown';

export interface BrokerageNoteUpload extends Document {
	userId: Types.ObjectId;
	provider: string;
	originalName: string;
	mimeType?: string;
	size?: number;
	kind?: BrokerageUploadKind;
	status: BrokerageNoteStatus;
	errorMessage?: string;
	processedAt?: Date;
	stats?: {
		tradesImported?: number;
		assetsUpdated?: number;
		portfolioId?: string;
	};
	createdAt?: Date;
	updatedAt?: Date;
}

const brokerageNoteUploadSchema = new Schema<BrokerageNoteUpload>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		provider: { type: String, required: true, index: true },
		originalName: { type: String, required: true },
		mimeType: { type: String, default: null },
		size: { type: Number, default: null },
		kind: {
			type: String,
			enum: ['brokerage_note', 'b3_report', 'unknown'],
			default: 'unknown',
		},
		status: {
			type: String,
			enum: ['received', 'queued', 'processing', 'processed', 'failed'],
			default: 'received',
		},
		errorMessage: { type: String, default: null },
		processedAt: { type: Date, default: null },
		stats: {
			tradesImported: { type: Number, default: 0 },
			assetsUpdated: { type: Number, default: 0 },
			portfolioId: { type: String, default: null },
		},
	},
	{ timestamps: true }
);

brokerageNoteUploadSchema.index({ userId: 1, createdAt: -1 });

export const BrokerageNoteUploadModel = model<BrokerageNoteUpload>(
	'BrokerageNoteUpload',
	brokerageNoteUploadSchema
);
