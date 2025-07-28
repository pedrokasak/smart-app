import { Schema, Document, model, Types } from 'mongoose';

export interface Profile extends Document {
	user: Types.ObjectId;
	cpf?: string;
	permissions: Types.ObjectId[];
	createdAt?: Date;
	updatedAt?: Date;
}

const profileSchema = new Schema<Profile>({
	user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	cpf: { type: String, unique: true, required: false },
	permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }],
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

profileSchema.set('toJSON', { virtuals: true });
profileSchema.set('toObject', { virtuals: true });

export const ProfileModel = model<Profile>('Profile', profileSchema);
