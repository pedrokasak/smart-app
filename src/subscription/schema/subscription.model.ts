import { Schema, Document, model } from 'mongoose';

export interface Subscription extends Document {
	name: string;
	description?: string;
	price: number;
	currency: string;
	interval: 'month' | 'year' | 'week' | 'day';
	intervalCount: number;
	stripePriceId?: string;
	stripeProductId?: string;
	isActive: boolean;
	features?: string[];
	maxUsers?: number;
	createdAt?: Date;
	updatedAt?: Date;
}

const subscriptionSchema = new Schema<Subscription>({
	name: { type: String, required: true },
	description: { type: String },
	price: { type: Number, required: true },
	currency: { type: String, default: 'BRL', required: true },
	interval: {
		type: String,
		enum: ['month', 'year', 'week', 'day'],
		default: 'month',
		required: true,
	},
	intervalCount: { type: Number, default: 1, required: true },
	stripePriceId: { type: String, unique: true, sparse: true },
	stripeProductId: { type: String, unique: true, sparse: true },
	isActive: { type: Boolean, default: true },
	features: [{ type: String }],
	maxUsers: { type: Number },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

subscriptionSchema.index({ name: 1 });
subscriptionSchema.index({ isActive: 1 });

export const SubscriptionModel = model<Subscription>(
	'Subscription',
	subscriptionSchema
);
