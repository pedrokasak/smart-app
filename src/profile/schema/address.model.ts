import { Schema, Document, model } from 'mongoose';

export interface Address extends Document {
	profileId: string;
	street: string;
	number?: string;
	complement?: string;
	neighborhood: string;
	city: string;
	state: string;
	zipCode: string;
	isDefault: boolean;
	type: AddressType;
	createdAt?: Date;
	updatedAt?: Date;
}

export enum AddressType {
	HOME = 'HOME',
	WORK = 'WORK',
	BILLING = 'BILLING',
	SHIPPING = 'SHIPPING',
	OTHER = 'OTHER',
}

const addressSchema = new Schema<Address>({
	profileId: { type: String, required: true, ref: 'Profile' },
	street: { type: String, required: true },
	number: { type: String, required: false },
	complement: { type: String, required: false },
	neighborhood: { type: String, required: true },
	city: { type: String, required: true },
	state: { type: String, required: true },
	zipCode: { type: String, required: true },
	isDefault: { type: Boolean, default: false },
	type: {
		type: String,
		enum: Object.values(AddressType),
		default: AddressType.HOME,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Índices para melhor performance
addressSchema.index({ profileId: 1 });
addressSchema.index({ zipCode: 1 });
addressSchema.index({ city: 1 });
addressSchema.index({ isDefault: 1 });

// Middleware para atualizar updatedAt
addressSchema.pre('save', function (next) {
	this.updatedAt = new Date();
	next();
});

export const AddressModel = model<Address>('Address', addressSchema);
