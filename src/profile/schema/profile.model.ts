import { Schema, Document, model } from 'mongoose';

export interface Profile extends Document {
	users: string[];
	userId: string;
	cpf?: string;
	address: string;
	permissions: string[];
	createdAt?: Date;
	updatedAt?: Date;
}

const profileSchema = new Schema<Profile>({
	users: [{ type: Schema.Types.ObjectId, ref: 'User' }], // Um perfil pode ter vários usuários
	cpf: { type: String, unique: true, required: false },
	address: { type: String, required: true },
	permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }], // Várias permissões
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

export const ProfileModel = model<Profile>('Profile', profileSchema);
