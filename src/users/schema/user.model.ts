import { Schema, Types, model } from 'mongoose';

export interface User extends Document {
	_id?: Types.ObjectId;
	firstName?: string;
	lastName?: string;
	avatar?: string;
	email: string;
	password: string;
	cpf?: string;
	profile: Types.ObjectId;
	permissions: Types.ObjectId[];
	userSubscription?: string;
	refreshToken?: string;
	isEmailVerified?: boolean;
	isActive: boolean;
	lastLogin?: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

const userSchema = new Schema<User>(
	{
		// Autenticação
		email: {
			type: String,
			unique: true,
			required: true,
			lowercase: true,
			trim: true,
			match: /.+\@.+\..+/,
		},

		password: {
			type: String,
			required: true,
			select: false,
		},

		// Informações Básicas
		firstName: {
			type: String,
			trim: true,
		},

		lastName: {
			type: String,
			trim: true,
		},
		// Dados Pessoais
		cpf: {
			type: String,
			unique: true,
			sparse: true, // Permite múltiplos null
			match: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/, // Validação CPF
		},

		avatar: String,

		// Segurança
		refreshToken: {
			type: String,
			default: null,
			select: false,
		},

		isEmailVerified: {
			type: Boolean,
			default: false,
		},

		isActive: {
			type: Boolean,
			default: true,
		},

		// Relacionamentos
		permissions: [
			{
				type: Schema.Types.ObjectId,
				ref: 'Permission',
			},
		],

		// Billing
		userSubscription: String,

		// Auditoria
		lastLogin: Date,
	},
	{
		timestamps: true,
	}
);

userSchema.index({ email: 1 });
userSchema.index({ createdAt: -1 });

userSchema.virtual('fullName').get(function () {
	return `${this.firstName} ${this.lastName}`;
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

export const UserModel = model<User>('User', userSchema);
