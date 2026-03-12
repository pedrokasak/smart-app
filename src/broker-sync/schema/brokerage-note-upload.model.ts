import { Schema, model, Types, Document } from 'mongoose';

export type BrokerageNoteStatus = 'received' | 'queued' | 'processed' | 'failed';

export interface BrokerageNoteUpload extends Document {
	userId: Types.ObjectId;
	provider: string;
	originalName: string;
	mimeType?: string;
	size?: number;
	status: BrokerageNoteStatus;
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
		status: {
			type: String,
			enum: ['received', 'queued', 'processed', 'failed'],
			default: 'received',
		},
	},
	{ timestamps: true }
);

brokerageNoteUploadSchema.index({ userId: 1, createdAt: -1 });

export const BrokerageNoteUploadModel = model<BrokerageNoteUpload>(
	'BrokerageNoteUpload',
	brokerageNoteUploadSchema
);

