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
	/**
	 * Anti-automacao da verificacao TOTP (TRA-140). Aditivos e opcionais:
	 * ausencia significa "nunca errou". Ver
	 * `src/two-factor/security/two-factor-attempt-policy.ts`.
	 */
	twoFactorFailedAttempts?: number;
	twoFactorFirstFailedAttemptAt?: Date | null;
	/**
	 * Codigos de recuperacao do 2FA. Aditivos e opcionais: ausencia
	 * significa "nunca gerou". Guardamos o digest SHA-256 e o carimbo de uso —
	 * nunca o codigo. A entrada consumida permanece na lista com `usedAt`
	 * preenchido, para que o uso continue auditavel. Ver
	 * `src/two-factor/security/recovery-codes.ts`.
	 */
	twoFactorRecoveryCodes?: { hash: string; usedAt?: Date | null }[];
	twoFactorRecoveryCodesGeneratedAt?: Date | null;
	role: Role;
	notificationPreferences?: {
		portfolioDigest?: {
			enabled: boolean;
			lastDigestSentAt?: Date;
			updatedAt?: Date;
		};
		email?: {
			dividendReceived?: boolean;
			allocationBreached?: boolean;
			portfolioScoreDropped?: boolean;
			aiInsightHigh?: boolean;
			quoteStale?: boolean;
			subscriptionExpiring?: boolean;
		};
		push?: {
			dividendReceived?: boolean;
			allocationBreached?: boolean;
			portfolioScoreDropped?: boolean;
			aiInsightHigh?: boolean;
			quoteStale?: boolean;
			subscriptionExpiring?: boolean;
		};
	};
	/**
	 * Politica de limiares por usuario (TRA-136, fase 4). Aditivo e todo
	 * opcional: quem nunca configurou nada cai nos defaults do sistema
	 * (`SYSTEM_THRESHOLD_POLICY`), resolvidos em `resolveThresholdPolicy`.
	 */
	thresholdPolicy?: {
		allocationDriftBandPp?: number;
		scoreDropPoints?: number;
		cooldownHours?: number;
		quoteStaleAfterMinutes?: number;
	};
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

		// Contagem de tentativas TOTP erradas (TRA-140). `select: false` porque
		// e estado interno de seguranca: nenhum payload de usuario precisa
		// dele, e quem le explicitamente e so `authenticateWithTwoFactor`.
		twoFactorFailedAttempts: {
			type: Number,
			default: 0,
			select: false,
		},
		twoFactorFirstFailedAttemptAt: {
			type: Date,
			default: null,
			select: false,
		},

		// Codigos de recuperacao do 2FA. `select: false` pelo mesmo
		// motivo do segredo TOTP: e material de autenticacao, e nenhum payload
		// de usuario deve carrega-lo por acidente. Quem le pede explicitamente,
		// e so o `TwoFactorService`. `_id: false` porque a entrada nao e uma
		// entidade — nao ha nada que faca sentido referenciar por id aqui.
		twoFactorRecoveryCodes: {
			type: [
				new Schema(
					{
						hash: { type: String, required: true },
						usedAt: { type: Date, default: null },
					},
					{ _id: false }
				),
			],
			default: undefined,
			select: false,
		},
		twoFactorRecoveryCodesGeneratedAt: {
			type: Date,
			default: null,
			select: false,
		},

		// RBAC
		role: {
			type: String,
			enum: Object.values(Role),
			default: Role.User,
		},

		// Auditoria
		lastLogin: Date,

		// Preferências de notificação — separado do LGPD/cookie consent do
		// web (ConsentContext), que é sobre tracking, não e-mail.
		notificationPreferences: {
			portfolioDigest: {
				enabled: { type: Boolean, default: false },
				lastDigestSentAt: { type: Date, default: null },
				updatedAt: { type: Date, default: null },
			},
			// Preferencias por evento (TRA-38). Defaults conservadores estao em
			// src/notifications/events/domain/notification.types.ts — o service
			// aplica esses defaults quando o campo esta ausente aqui, entao o
			// schema nao precisa repeti-los (evita drift entre codigo e schema).
			email: {
				dividendReceived: { type: Boolean, default: undefined },
				allocationBreached: { type: Boolean, default: undefined },
				portfolioScoreDropped: { type: Boolean, default: undefined },
				aiInsightHigh: { type: Boolean, default: undefined },
				quoteStale: { type: Boolean, default: undefined },
				subscriptionExpiring: { type: Boolean, default: undefined },
			},
			push: {
				dividendReceived: { type: Boolean, default: undefined },
				allocationBreached: { type: Boolean, default: undefined },
				portfolioScoreDropped: { type: Boolean, default: undefined },
				aiInsightHigh: { type: Boolean, default: undefined },
				quoteStale: { type: Boolean, default: undefined },
				subscriptionExpiring: { type: Boolean, default: undefined },
			},
		},

		// Override por usuario da politica de limiares (TRA-136, fase 4).
		// Sem default: ausencia significa "usa o default do sistema", e um
		// default no schema congelaria o valor no doc do usuario.
		thresholdPolicy: {
			allocationDriftBandPp: { type: Number, default: undefined },
			scoreDropPoints: { type: Number, default: undefined },
			cooldownHours: { type: Number, default: undefined },
			quoteStaleAfterMinutes: { type: Number, default: undefined },
		},
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
