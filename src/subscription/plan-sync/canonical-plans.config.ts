/**
 * Definição canônica dos planos comerciais (TRA-18).
 *
 * Fonte única de verdade para nome, descrição, preços em BRL e features
 * mostradas na landing (`design_handoff_trackerr/Trackerr Landing.dc.html`).
 *
 * Regras de arquitetura (CLAUDE.md §4.4 e §6.1):
 *   - Stripe é a fonte de verdade comercial; o banco espelha.
 *   - Nenhum ID Stripe é hard-coded neste arquivo. O sync acha os IDs por
 *     variável de ambiente, por `lookup_key` ou pelo produto ativo com o
 *     mesmo `name` na conta da chave configurada. Sem nenhum deles, deixa o
 *     campo como está e loga TODO — nunca inventa ID de Stripe.
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
/**
 * Recursos cumulativos por construção: cada plano repete tudo do plano
 * abaixo, porque a tabela de comparação e os cards leem `features` por plano.
 * Limites de carteira/conta ficam na `description`, não aqui — "1 carteira"
 * não pode aparecer marcado no Pro.
 */
const ESSENCIAL_FEATURES = [
	'Alocação e proventos',
	'Research de ativos',
	'RI Inteligente (fatos relevantes)',
	'Copiloto em modo Iniciante',
	'Suporte por e-mail',
];

const PRO_FEATURES = [
	...ESSENCIAL_FEATURES,
	'Comparador de ativos lado a lado',
	'Sincronização direta com corretora',
	'Relatório de Imposto de Renda',
	'Relatórios exportáveis (PDF/XLSX)',
	'Copiloto até modo Avançado',
	'Suporte prioritário',
];

const WEALTH_FEATURES = [
	...PRO_FEATURES,
	'Módulo fiscal com DARF',
	'Radar de oportunidades e IA Insights',
	'VaR, Sharpe, beta e atribuição',
	'Política de investimento e alertas',
	'Trilha de auditoria da IA',
	'Onboarding guiado 1:1',
];

export const CANONICAL_PLANS: CanonicalPlan[] = [
	{
		slug: 'essencial',
		kind: 'free',
		accessLevel: FREE_ACCESS_LEVEL,
		name: 'Essencial',
		description: 'Para começar a organizar: 1 carteira e 1 corretora.',
		monthlyPrice: 0,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: ESSENCIAL_FEATURES,
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
			'Ativos ilimitados em até 5 contas, para quem investe em mais de uma corretora.',
		// Só fallback: com o produto "Pro" encontrado no Stripe, o sync grava
		// o `unit_amount` real no plano (TRA-206).
		monthlyPrice: 19.9,
		annualPrice: 179.9,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: PRO_FEATURES,
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
			'Multi-carteira ilimitada em até 20 contas, com risco quantitativo e política de investimento.',
		monthlyPrice: 39.9,
		annualPrice: 329.9,
		currency: 'brl',
		interval: 'month',
		intervalCount: 1,
		features: WEALTH_FEATURES,
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
