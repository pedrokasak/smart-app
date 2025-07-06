import { Schema, Document, model, Types } from 'mongoose';

export interface UserSubscription extends Document {
	user: Types.ObjectId;
	subscription: Types.ObjectId;
	stripeSubscriptionId?: string;
	stripeCustomerId?: string;
	status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
	canceledAt?: Date;
	endedAt?: Date;
	trialStart?: Date;
	trialEnd?: Date;
	quantity: number;
	createdAt?: Date;
	updatedAt?: Date;
}

const userSubscriptionSchema = new Schema<UserSubscription>({
	user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	subscription: {
		type: Schema.Types.ObjectId,
		ref: 'Subscription',
		required: true,
	},
	stripeSubscriptionId: { type: String, unique: true, sparse: true },
	stripeCustomerId: { type: String },
	status: {
		type: String,
		enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'],
		default: 'active',
		required: true,
	},
	currentPeriodStart: { type: Date, required: true },
	currentPeriodEnd: { type: Date, required: true },
	cancelAtPeriodEnd: { type: Boolean, default: false },
	canceledAt: { type: Date },
	endedAt: { type: Date },
	trialStart: { type: Date },
	trialEnd: { type: Date },
	quantity: { type: Number, default: 1 },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

userSubscriptionSchema.index({ user: 1 });
userSubscriptionSchema.index({ stripeSubscriptionId: 1 });
userSubscriptionSchema.index({ status: 1 });
userSubscriptionSchema.index({ currentPeriodEnd: 1 });

// Virtual para verificar se a assinatura está ativa
userSubscriptionSchema.virtual('isActive').get(function () {
	return this.status === 'active' || this.status === 'trialing';
});

// Virtual para verificar se está em período de teste
userSubscriptionSchema.virtual('isTrialing').get(function () {
	return (
		this.status === 'trialing' && this.trialEnd && this.trialEnd > new Date()
	);
});

userSubscriptionSchema.set('toJSON', { virtuals: true });
userSubscriptionSchema.set('toObject', { virtuals: true });

export const UserSubscriptionModel = model<UserSubscription>(
	'UserSubscription',
	userSubscriptionSchema
);
