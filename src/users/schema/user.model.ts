import { Schema, Types, model } from 'mongoose';
import { Role } from 'src/auth/enums/role.enum';

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
	stripeCustomerId?: string;
	refreshToken?: string;
	resetPasswordToken?: string;
	resetPasswordExpires?: Date;
	isEmailVerified?: boolean;
	isActive: boolean;
	lastLogin?: Date;
	twoFactorSecret?: string;
	twoFactorEnabled: boolean;
	role: Role;
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
		resetPasswordToken: {
			type: String,
			select: false,
		},
		resetPasswordExpires: {
			type: Date,
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
		stripeCustomerId: String,

		// 2FA
		twoFactorSecret: {
			type: String,
			select: false,
		},
		twoFactorEnabled: {
			type: Boolean,
			default: false,
		},

		// RBAC
		role: {
			type: String,
			enum: Object.values(Role),
			default: Role.User,
		},

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
