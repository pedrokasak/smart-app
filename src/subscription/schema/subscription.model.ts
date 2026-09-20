import { Schema, Document, model } from 'mongoose';

export interface Subscription extends Document {
	name: string;
	description?: string;
	price: number;
	currency: string;
	interval: 'month' | 'year' | 'week' | 'day';
	intervalCount: number;
	/**
	 * Nível de acesso que o plano libera — número livre definido no admin,
	 * independente do nome exibido (TRA-182). Não há lista fixa de níveis.
	 */
	accessLevel?: number;
	stripePriceId?: string;
	stripeProductId?: string;
	annualPrice?: number;
	annualStripePriceId?: string;
	isFeatured?: boolean;
	isComingSoon?: boolean;
	isActive: boolean;
	features?: string[];
	/**
	 * Capability keys liberadas por este plano (TRA-189), separadas do texto
	 * de vitrine em `features`. Lista ausente/vazia significa "nunca
	 * configurado pelo admin" — o gate cai no fallback por `accessLevel`, ver
	 * `planHasCapability`.
	 */
	capabilities?: string[];
	maxUsers?: number;
	/**
	 * `true` (padrão): conteúdo do plano (nome, preço, features...) ainda é
	 * dono do `PlanSyncService` — o seed canônico pode sobrescrever em todo
	 * boot, igual sempre fez.
	 * `false`: um admin editou este plano pelo painel — a partir daí o sync
	 * só preenche campo vazio (backfill) e nunca mais sobrescreve valor já
	 * definido. Vínculos Stripe (`stripeProductId`/`stripePriceId`/
	 * `annualStripePriceId`) continuam reconciliando sempre, nos dois casos.
	 */
	catalogManaged?: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

const subscriptionSchema = new Schema<Subscription>({
	name: { type: String, required: true },
	description: { type: String },
	price: { type: Number, required: true },
	currency: { type: String, default: 'BRL', required: true },
	interval: {
		type: String,
		enum: ['month', 'year', 'week', 'day'],
		default: 'month',
		required: true,
	},
	intervalCount: { type: Number, default: 1, required: true },
	accessLevel: { type: Number },
	stripePriceId: { type: String, unique: true, sparse: true },
	stripeProductId: { type: String, unique: true, sparse: true },
	annualPrice: { type: Number },
	annualStripePriceId: { type: String, unique: true, sparse: true },
	isFeatured: { type: Boolean, default: false },
	isComingSoon: { type: Boolean, default: false },
	isActive: { type: Boolean, default: true },
	features: [{ type: String }],
	capabilities: [{ type: String }],
	maxUsers: { type: Number },
	catalogManaged: { type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

subscriptionSchema.index({ name: 1 });
subscriptionSchema.index({ isActive: 1 });

export const SubscriptionModel = model<Subscription>(
	'Subscription',
	subscriptionSchema
);
