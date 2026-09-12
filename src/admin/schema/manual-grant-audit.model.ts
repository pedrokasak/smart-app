import { Document, Schema, Types, model } from 'mongoose';
import { ManualGrantType } from '../constants/admin.constants';

export interface ManualGrantAudit extends Document {
	user: Types.ObjectId;
	userEmail: string;
	plan: Types.ObjectId;
	grantType: ManualGrantType;
	trialDurationDays?: number;
	discountPercent?: number;
	performedBy: Types.ObjectId;
	performedByEmail: string;
	notes?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const manualGrantAuditSchema = new Schema<ManualGrantAudit>(
	{
		user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		userEmail: { type: String, required: true, lowercase: true, trim: true },
		plan: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
		grantType: {
			// Não usa enum estrito no schema para preservar leitura de registros
			// legados persistidos com o valor 'TRIAL_7_DAYS' (pré TRA-116).
			type: String,
			required: true,
		},
		trialDurationDays: { type: Number },
		discountPercent: { type: Number, min: 0, max: 100 },
		performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		performedByEmail: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
		notes: { type: String, trim: true },
	},
	{ timestamps: true }
);

manualGrantAuditSchema.index({ createdAt: -1 });
manualGrantAuditSchema.index({ userEmail: 1 });
manualGrantAuditSchema.index({ performedByEmail: 1 });

export const ManualGrantAuditModel = model<ManualGrantAudit>(
	'ManualGrantAudit',
	manualGrantAuditSchema
);
