/**
 * Nivel de acesso do usuario, em ordem crescente (TRA-79, TRA-182).
 *
 * E um numero, nao um nome fixo: o admin define o nivel de CADA plano
 * livremente em `/admin/plans` (qualquer inteiro >= 0), sem editar codigo
 * nem escolher de uma lista fechada como 'free'/'pro'/'premium'. Dois
 * planos pagos por exemplo podem estar em 10 e 20 hoje e um terceiro
 * plano intermediario amanha entrar em 15 sem tocar em nada aqui.
 *
 * O que continua exigindo codigo e decidir, PARA UMA FEATURE NOVA, a
 * partir de qual nivel ela libera — isso e trabalho de desenvolvimento
 * por natureza (a feature em si teve que ser implementada). As constantes
 * abaixo documentam os patamares que as features HOJE usam; elas nao
 * limitam quais niveis um plano pode ter.
 */
export type UserPlanTier = number;

/** Nivel efetivo quando nao ha assinatura ativa ou a consulta falha. */
export const FREE_ACCESS_LEVEL = 0;

/** Patamar minimo usado hoje pelas features "Pro" (fiscal, corretora, RAG). */
export const PRO_ACCESS_LEVEL = 10;

/** Patamar minimo usado hoje pelas features "Wealth" (IA Insights, radar). */
export const PREMIUM_ACCESS_LEVEL = 20;

export function planAtLeast(
	actual: UserPlanTier,
	required: UserPlanTier
): boolean {
	return actual >= required;
}

export const USER_PLAN_RESOLVER = Symbol('USER_PLAN_RESOLVER');

export interface UserPlanResolverPort {
	/**
	 * Nivel de acesso efetivo do usuario. Devolve `FREE_ACCESS_LEVEL` quando
	 * nao ha assinatura ativa, quando o plano nao tem nivel configurado nem
	 * nome reconhecido, ou quando a consulta falha — negar acesso em caso de
	 * duvida e o comportamento seguro pra um gate de feature paga.
	 */
	resolve(userId: string): Promise<UserPlanTier>;
}
