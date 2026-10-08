import { ForbiddenException } from '@nestjs/common';
import {
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	UserPlanTier,
} from './user-plan.types';

/**
 * Cota de plano (TRA-197): contagem no momento da criação, não liga/desliga
 * como a capability. Bloqueia CRIAR; nunca apaga nem esconde o que já existe
 * (usuário que já passou do limite continua vendo tudo).
 */
export type PlanQuotaResource = 'assets' | 'portfolios' | 'broker_connections';

export const ALL_PLAN_QUOTA_RESOURCES: PlanQuotaResource[] = [
	'assets',
	'portfolios',
	'broker_connections',
];

/** `null` = ilimitado. Recurso ausente = o admin ainda não decidiu. */
export type PlanQuotas = Partial<Record<PlanQuotaResource, number | null>>;

export const PLAN_QUOTA_LABELS: Record<PlanQuotaResource, string> = {
	assets: 'ativos',
	portfolios: 'carteiras',
	broker_connections: 'contas de corretora',
};

/**
 * Início da mensagem de erro. O web reconhece "Limite de portfólios" para
 * mostrar o texto amigável do limite de carteiras (useBrokerSync): a frase
 * continua igual ao que o server já devolvia antes das cotas.
 */
const LIMIT_REACHED_NOUN: Record<PlanQuotaResource, string> = {
	assets: 'ativos',
	portfolios: 'portfólios',
	broker_connections: 'contas de corretora',
};

/**
 * Limite por nível quando o plano nunca teve esse recurso configurado pelo
 * admin — o que os cards de plano já prometem (TRA-194/TRA-197). Carteira em
 * plano pago segue ilimitada, como o código já fazia antes das cotas.
 */
export function defaultPlanQuota(
	resource: PlanQuotaResource,
	tier: UserPlanTier
): number | null {
	switch (resource) {
		case 'assets':
			return tier >= PRO_ACCESS_LEVEL ? null : 10;
		case 'portfolios':
			return tier >= PRO_ACCESS_LEVEL ? null : 1;
		case 'broker_connections':
			if (tier >= PREMIUM_ACCESS_LEVEL) return 20;
			return tier >= PRO_ACCESS_LEVEL ? 5 : 1;
	}
}

/**
 * Limite efetivo do recurso. O que o admin gravou no plano manda (inclusive
 * `null` = ilimitado); recurso que o plano não decidiu cai no padrão do nível.
 */
export function planQuotaLimit(
	quotas: PlanQuotas | null | undefined,
	resource: PlanQuotaResource,
	tier: UserPlanTier
): number | null {
	const configured = quotas?.[resource];
	if (configured === null) return null;
	if (typeof configured === 'number' && configured >= 0) return configured;
	return defaultPlanQuota(resource, tier);
}

/** Limite de todos os recursos, já resolvido — o que o painel mostra. */
export function effectivePlanQuotas(
	quotas: PlanQuotas | null | undefined,
	tier: UserPlanTier
): Record<PlanQuotaResource, number | null> {
	return Object.fromEntries(
		ALL_PLAN_QUOTA_RESOURCES.map((resource) => [
			resource,
			planQuotaLimit(quotas, resource, tier),
		])
	) as Record<PlanQuotaResource, number | null>;
}

/** Lê `quotas` do plano gravado, ignorando lixo (campo ausente, negativo...). */
export function normalizePlanQuotas(raw: unknown): PlanQuotas | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const source = raw as Record<string, unknown>;
	const quotas: PlanQuotas = {};
	for (const resource of ALL_PLAN_QUOTA_RESOURCES) {
		const value = source[resource];
		if (value === null) quotas[resource] = null;
		else if (typeof value === 'number' && value >= 0) quotas[resource] = value;
	}
	return Object.keys(quotas).length ? quotas : undefined;
}

export const PLAN_QUOTA_ERROR = 'PLAN_QUOTA_EXCEEDED';

export function planQuotaExceeded(
	resource: PlanQuotaResource,
	limit: number
): ForbiddenException {
	return new ForbiddenException({
		statusCode: 403,
		error: PLAN_QUOTA_ERROR,
		message: `Limite de ${LIMIT_REACHED_NOUN[resource]} atingido. Seu plano permite até ${limit} ${PLAN_QUOTA_LABELS[resource]}. Faça upgrade para adicionar mais.`,
		resource,
		limit,
	});
}

export const PLAN_QUOTA_USAGE = Symbol('PLAN_QUOTA_USAGE');

/** Quanto o usuário já tem de cada recurso. Implementado sobre o banco. */
export interface PlanQuotaUsagePort {
	count(userId: string, resource: PlanQuotaResource): Promise<number>;
}
