import { Document, Schema, Types } from 'mongoose';

export type UpcomingDividendPaymentType =
	| 'JCP'
	| 'DIVIDEND'
	| 'RENDIMENTO'
	| 'OTHER';

export interface UpcomingDividend extends Document {
	userId: Types.ObjectId;
	portfolioId: Types.ObjectId;
	symbol: string;
	name?: string;
	paymentType: UpcomingDividendPaymentType;
	expectedPaymentDate: Date;
	quantity: number;
	unitValue: number;
	netValue: number;
	institution?: string;
	source: 'b3_events';
	importedAt: Date;
}

export const upcomingDividendSchema = new Schema<UpcomingDividend>(
	{
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		portfolioId: {
			type: Schema.Types.ObjectId,
			ref: 'Portfolio',
			required: true,
		},
		symbol: { type: String, required: true, uppercase: true, trim: true },
		name: { type: String, trim: true },
		paymentType: {
			type: String,
			enum: ['JCP', 'DIVIDEND', 'RENDIMENTO', 'OTHER'],
			required: true,
		},
		expectedPaymentDate: { type: Date, required: true },
		quantity: { type: Number, default: 0 },
		unitValue: { type: Number, default: 0 },
		netValue: { type: Number, required: true, min: 0 },
		institution: { type: String, trim: true },
		source: { type: String, enum: ['b3_events'], default: 'b3_events' },
		importedAt: { type: Date, required: true },
	},
	{ timestamps: true }
);

upcomingDividendSchema.index({ userId: 1, expectedPaymentDate: 1 });
upcomingDividendSchema.index({ portfolioId: 1 });
