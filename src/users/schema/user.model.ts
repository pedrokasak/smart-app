import { Schema, Types, model } from 'mongoose';

export interface User extends Document {
	firstName?: string;
	lastName?: string;
	email: string;
	password: string;
	profile: Types.ObjectId;
	stripeCustomerId?: string;
	refreshToken?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const userSchema = new Schema<User>({
	firstName: String,
	lastName: String,
	email: { type: String, unique: true },
	password: String,
	profile: { type: Schema.Types.ObjectId, ref: 'Profile', required: false },
	refreshToken: { type: String, default: null },
	stripeCustomerId: { type: String, default: null },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

userSchema.index({ email: 1 });

export const UserModel = model<User>('User', userSchema);
