import { Schema, Document, model, Types } from 'mongoose';

export interface Address extends Document {
	userId: Types.ObjectId;
	street: string;
	number?: string;
	complement?: string;
	neighborhood: string;
	city: string;
	state: string;
	zipCode: string;
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
	userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	street: { type: String, required: true },
	number: { type: String, required: false },
	complement: { type: String, required: false },
	neighborhood: { type: String, required: true },
	city: { type: String, required: true },
	state: { type: String, required: true },
	zipCode: { type: String, required: true },
	type: {
		type: String,
		enum: Object.values(AddressType),
		default: AddressType.HOME,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

addressSchema.index({ userId: 1 });
addressSchema.index({ city: 1 });
addressSchema.index({ zipCode: 1 });

addressSchema.pre('save', function (next) {
	this.updatedAt = new Date();
	next();
});

export const AddressModel = model<Address>('Address', addressSchema);
