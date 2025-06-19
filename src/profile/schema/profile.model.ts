import { Schema, Document, model } from 'mongoose';

export interface Profile extends Document {
	users: string[];
	userId: string;
	cpf?: string;
	permissions: string[];
	createdAt?: Date;
	updatedAt?: Date;
}

const profileSchema = new Schema<Profile>({
	users: [{ type: Schema.Types.ObjectId, ref: 'User' }], // Um perfil pode ter vários usuários
	cpf: { type: String, unique: true, required: false },
	permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }], // Várias permissões
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

profileSchema.virtual('addresses', {
	ref: 'Address',
	localField: '_id',
	foreignField: 'profileId',
});

profileSchema.set('toJSON', { virtuals: true });
profileSchema.set('toObject', { virtuals: true });

export const ProfileModel = model<Profile>('Profile', profileSchema);
