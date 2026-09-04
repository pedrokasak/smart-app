/**
 * Definição canônica dos planos comerciais (TRA-18).
 *
 * Fonte única de verdade para nome, descrição, preços em BRL e features
 * mostradas na landing (`design_handoff_trackerr/Trackerr Landing.dc.html`).
 *
 * Regras de arquitetura (CLAUDE.md §4.4 e §6.1):
 *   - Stripe é a fonte de verdade comercial; o banco espelha.
 *   - Nenhum ID Stripe é hard-coded neste arquivo. Product/price IDs vêm
 *     por variável de ambiente para cada deploy (dev/prod). Se um ID não
 *     for informado, o sync deixa o campo como está e loga TODO — nunca
 *     inventa ID de Stripe.
 *   - Slug é a chave interna e estável usada para casar linhas legadas
 *     com o plano canônico correspondente. `name` pode mudar sem quebrar
 *     o match; `slug` não.
 *   - Match adicional por `aliases` (nomes históricos que já rodaram em
 *     produção) permite absorver planos antigos sem precisar de query
 *     manual no Mongo.
 *
 * `tier` amarra o plano ao `SubscriptionUserPlanResolver`, que gateia
 * features pagas. Manter esta coluna igual ao que o resolver espera é
 * o que garante que renomear "Pro" para "Trackerr Pro" no admin não
 * derrube o gate.
 */

import type { UserPlanTier } from 'src/subscription/application/user-plan.types';

export type BillingInterval = 'month' | 'year' | 'week' | 'day';

/**
 * Estratégia para planos sem preço mensal cobrado pelo Stripe.
 *   - `stripe_subscription`: plano cobrado via Stripe recurring (padrão).
 *   - `free`: plano gratuito, não precisa de product/price no Stripe.
 *   - `contact_sales`: plano custom, tratado fora do checkout self-service.
 */
export type CanonicalPlanKind = 'stripe_subscription' | 'free' | 'contact_sales';

export interface CanonicalPlan {
	/** Chave interna estável. Nunca renomear sem migração explícita. */
	slug: string;
	kind: CanonicalPlanKind;
	tier: UserPlanTier;
	name: string;
	description: string;
	/** Preço mensal em BRL (ex.: 149 = R$ 149,00). Use 0 para plano gratuito. */
	monthlyPrice: number;
	/**
	 * Preço anual COBRADO ao ano em BRL. Vem de env também
	 * (`STRIPE_PLAN_<SLUG>_ANNUAL_AMOUNT`) para não amarrar a política
	 * comercial no código; este é apenas o valor default do seed inicial.
	 */
	annualPrice?: number;
	currency: string;
	interval: BillingInterval;
	intervalCount: number;
	features: string[];
	isFeatured: boolean;
	isComingSoon: boolean;
	maxUsers?: number;
	/** Nomes históricos deste plano no banco (case-insensitive). */
	aliases: string[];
}

/**
 * Nota (TRA-18): os nomes canônicos preservam as palavras-chave que o
 * `SubscriptionUserPlanResolver.tierFromPlanName` usa por substring
 * (`pro`, `premium`, `global`/`investor`). Alterar os nomes sem revisar
 * o resolver derruba o gate de features pagas silenciosamente.
 */
export const CANONICAL_PLANS: CanonicalPlan[] = [
	{
		slug: 'essencial',
		kind: 'free',
		tier: 'free',
		name: 'Essencial',
		description:
			'Consolidação de até 10 ativos para quem está começando a organizar.',
		monthlyPrice: 0,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: [
			'1 carteira · 1 corretora',
			'Alocação e proventos',
			'Copiloto em modo Iniciante',
			'Suporte por e-mail',
		],
		isFeatured: false,
		isComingSoon: false,
		aliases: ['essencial', 'free', 'gratis', 'grátis', 'basic', 'iniciante'],
	},
	{
		slug: 'pro',
		kind: 'stripe_subscription',
		tier: 'pro',
		name: 'Pro',
		description:
			'Para o investidor que já tem carteira montada em mais de uma corretora.',
		monthlyPrice: 149,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: [
			'Ativos ilimitados · 5 contas',
			'Módulo fiscal com DARF',
			'Copiloto até modo Avançado',
			'Relatórios exportáveis (PDF/XLSX)',
			'Suporte prioritário',
		],
		isFeatured: true,
		isComingSoon: false,
		aliases: ['pro', 'plano pro', 'trackerr pro', 'plano destaque'],
	},
	{
		// slug mantém "premium" para casar com o `SubscriptionUserPlanResolver`
		// (tier `premium`), enquanto o nome visível segue o design handoff.
		slug: 'premium',
		kind: 'stripe_subscription',
		tier: 'premium',
		name: 'Wealth Premium',
		description:
			'Multi-carteira com risco quantitativo e política de investimento.',
		monthlyPrice: 389,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: [
			'Multi-carteira ilimitada · 20 contas',
			'VaR, Sharpe, beta e atribuição',
			'Política de investimento e alertas',
			'Trilha de auditoria da IA',
			'Onboarding guiado 1:1',
		],
		isFeatured: false,
		isComingSoon: false,
		aliases: ['premium', 'wealth', 'wealth premium', 'plano premium'],
	},
	{
		slug: 'enterprise',
		kind: 'contact_sales',
		tier: 'global_investor',
		name: 'Enterprise',
		description:
			'Escritórios, family offices e assessorias com múltiplos titulares.',
		monthlyPrice: 0,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: [
			'Usuários e permissões por papel',
			'SSO/SAML e logs de auditoria',
			'SLA 99,9% com contrato',
			'API e integrações dedicadas',
			'Gerente de conta nomeado',
		],
		isFeatured: false,
		isComingSoon: false,
		aliases: ['enterprise', 'global investor', 'global_investor'],
	},
];

/**
 * Convenção das variáveis de ambiente por slug (upper snake case):
 *   - STRIPE_PLAN_PRO_PRODUCT_ID
 *   - STRIPE_PLAN_PRO_PRICE_MONTHLY_ID
 *   - STRIPE_PLAN_PRO_PRICE_ANNUAL_ID
 *   - STRIPE_PLAN_PRO_ANNUAL_AMOUNT   (valor em BRL, opcional, override)
 */
export function envKeysForSlug(slug: string) {
	const upper = slug.toUpperCase();
	return {
		productId: `STRIPE_PLAN_${upper}_PRODUCT_ID`,
		monthlyPriceId: `STRIPE_PLAN_${upper}_PRICE_MONTHLY_ID`,
		annualPriceId: `STRIPE_PLAN_${upper}_PRICE_ANNUAL_ID`,
		annualAmount: `STRIPE_PLAN_${upper}_ANNUAL_AMOUNT`,
	};
}
