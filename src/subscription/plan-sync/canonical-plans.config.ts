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

import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
} from 'src/subscription/application/user-plan.types';

export type BillingInterval = 'month' | 'year' | 'week' | 'day';

/**
 * Estratégia para planos sem preço mensal cobrado pelo Stripe.
 *   - `stripe_subscription`: plano cobrado via Stripe recurring (padrão).
 *   - `free`: plano gratuito, não precisa de product/price no Stripe.
 *   - `contact_sales`: plano custom, tratado fora do checkout self-service.
 */
export type CanonicalPlanKind =
	| 'stripe_subscription'
	| 'free'
	| 'contact_sales';

export interface CanonicalPlan {
	/** Chave interna estável. Nunca renomear sem migração explícita. */
	slug: string;
	kind: CanonicalPlanKind;
	/** Nível de acesso (TRA-182) — número livre, sem lista fixa de nomes. */
	accessLevel: number;
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
		accessLevel: FREE_ACCESS_LEVEL,
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
			'Research de ativos',
			'RI Inteligente (fatos relevantes)',
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
		accessLevel: PRO_ACCESS_LEVEL,
		name: 'Pro',
		description:
			'Para o investidor que já tem carteira montada em mais de uma corretora.',
		// Espelha o produto "Investidor Pro" no Stripe: R$ 14,90/mês e
		// R$ 149,00/ano. Estes números vinham como 149 no mensal — que é o
		// preço ANUAL do mesmo produto — e o `sync` grava `monthlyPrice` no
		// campo `price` exibido na vitrine. Rodar o sync assim publicaria
		// R$ 149 numa assinatura que o Stripe cobra R$ 14,90 (TRA-150).
		monthlyPrice: 14.9,
		annualPrice: 149,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		// Cumulativo por extenso: a tabela de comparação (`Subscription.tsx`)
		// faz `plan.features.includes(feature)` por plano, sem herdar do nível
		// abaixo — o que o Essencial já tem precisa estar listado aqui de novo,
		// senão a linha aparece como "—" para o Pro.
		features: [
			'Ativos ilimitados · 5 contas',
			'Research de ativos',
			'Comparador de ativos lado a lado',
			'RI Inteligente (fatos relevantes)',
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
		accessLevel: PREMIUM_ACCESS_LEVEL,
		name: 'Wealth',
		description:
			'Multi-carteira com risco quantitativo e política de investimento.',
		// Espelha o produto "Premium" no Stripe: R$ 24,90/mês e R$ 249,00/ano
		// (TRA-150). O valor anterior, 389, não corresponde a nenhum preço
		// existente na conta.
		monthlyPrice: 24.9,
		annualPrice: 249,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		// Mesmo motivo do Pro: tudo que o Pro tem precisa estar listado aqui
		// de novo, mais o que é exclusivo do Wealth — em especial
		// 'ai.insights', a capability que efetivamente distingue este plano
		// (TRA-189/193), e que não aparecia em nenhum card até aqui.
		features: [
			'Multi-carteira ilimitada · 20 contas',
			'Research de ativos',
			'Comparador de ativos lado a lado',
			'RI Inteligente (fatos relevantes)',
			'Módulo fiscal com DARF',
			'Copiloto até modo Avançado',
			'Relatórios exportáveis (PDF/XLSX)',
			'Radar de oportunidades e IA Insights',
			'VaR, Sharpe, beta e atribuição',
			'Política de investimento e alertas',
			'Trilha de auditoria da IA',
			'Onboarding guiado 1:1',
		],
		isFeatured: false,
		isComingSoon: false,
		aliases: ['premium', 'wealth', 'wealth premium', 'plano premium'],
	},
	// Enterprise (tier global_investor) saiu da vitrine no lançamento: são dois
	// planos pagos além do gratuito. O tier segue valendo para concessões e
	// para um plano novo criado no admin.
];

/**
 * Convenção das variáveis de ambiente por slug (upper snake case):
 *   - STRIPE_PLAN_PRO_PRODUCT_ID
 *   - STRIPE_PLAN_PRO_PRICE_MONTHLY_ID
 *   - STRIPE_PLAN_PRO_PRICE_ANNUAL_ID
 *   - STRIPE_PLAN_PRO_ANNUAL_AMOUNT   (valor em BRL, opcional, override)
 */
/**
 * `lookup_key` dos preços no Stripe. Criar o preço com esta chave basta
 * para o sync do boot vincular o plano, na conta de teste ou na live.
 */
export function lookupKeysForSlug(slug: string) {
	return {
		monthly: `trackerr_${slug}_monthly`,
		annual: `trackerr_${slug}_annual`,
	};
}

export function envKeysForSlug(slug: string) {
	const upper = slug.toUpperCase();
	return {
		productId: `STRIPE_PLAN_${upper}_PRODUCT_ID`,
		monthlyPriceId: `STRIPE_PLAN_${upper}_PRICE_MONTHLY_ID`,
		annualPriceId: `STRIPE_PLAN_${upper}_PRICE_ANNUAL_ID`,
		annualAmount: `STRIPE_PLAN_${upper}_ANNUAL_AMOUNT`,
	};
}
