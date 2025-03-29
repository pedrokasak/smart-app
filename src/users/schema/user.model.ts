import { Schema, Types, model } from 'mongoose';

export interface User extends Document {
	firstName?: string;
	lastName?: string;
	email: string;
	password: string;
	profile: Types.ObjectId;
	createdAt?: Date;
	updatedAt?: Date;
}

const userSchema = new Schema<User>({
	profile: { type: Schema.Types.ObjectId, ref: 'Profile', required: false },
	firstName: String,
	lastName: String,
	email: { type: String, unique: true },
	password: String,
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

userSchema.index({ email: 1 }); // Index para e-mail

export const UserModel = model<User>('User', userSchema);
