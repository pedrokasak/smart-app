import { Schema, Document, model, Types } from 'mongoose';
import { Address, AddressModel } from 'src/address/schema/address.model';

export interface Profile extends Document {
	user: Types.ObjectId;

	phone?: string;
	birthDate?: Date;

	// Endereço
	address?: Address;

	// Preferências
	preferences?: Preferences;
	maxPortfolios: number;

	// Status
	isProfileComplete: boolean;

	// Auditoria
	createdAt: Date;
	updatedAt: Date;
}

export interface Preferences {
	language?: 'pt-BR' | 'en-US' | 'es-ES';
	theme?: 'light' | 'dark';
	notifications?: boolean;
	twoFactorEnabled?: boolean;
}

const preferencesSchema = new Schema<Preferences>(
	{
		language: {
			type: String,
			enum: ['pt-BR', 'en-US', 'es-ES'],
			default: 'pt-BR',
		},
		theme: {
			type: String,
			enum: ['light', 'dark'],
			default: 'light',
		},
		notifications: {
			type: Boolean,
			default: true,
		},
		twoFactorEnabled: {
			type: Boolean,
			default: false,
		},
	},
	{ _id: false }
);

const profileSchema = new Schema<Profile>(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true, // Um profile por user
		},

		phone: {
			type: String,
			match: /^\(\d{2}\) \d{4,5}-\d{4}$/, // Formato: (11) 99999-9999
		},

		birthDate: Date,

		// Endereço
		address: AddressModel.schema,

		// Preferências
		preferences: {
			type: preferencesSchema,
			default: {},
		},

		maxPortfolios: {
			type: Number,
			default: 1,
		},

		// Status
		isProfileComplete: {
			type: Boolean,
			default: false,
		},
	},
	{
		timestamps: true,
	}
);

// Índices
profileSchema.index({ user: 1 });
profileSchema.index({ cpf: 1 });
profileSchema.index({ plan: 1 });

profileSchema.set('toJSON', { virtuals: true });
profileSchema.set('toObject', { virtuals: true });

export const ProfileModel = model<Profile>('Profile', profileSchema);
