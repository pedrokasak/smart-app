/**
 * Niveis de plano do produto, em ordem crescente de acesso (TRA-79).
 *
 * Antes disto nao existia um tipo: o orquestrador de chat lia um campo
 * `plan` de dentro de objetos de carteira tipados como `any[]`, e o
 * servico de IR resolvia plano de um jeito completamente diferente
 * (substring no nome + palavras-chave em `features`). Duas respostas
 * possiveis pra mesma pergunta, o que contraria o principio 11 do
 * CLAUDE.md (logica de negocio duplicada).
 */
export type UserPlanTier = 'free' | 'pro' | 'premium' | 'global_investor';

/** Ordem de acesso. Usado pra comparar niveis sem espalhar switch pelo codigo. */
export const PLAN_RANK: Record<UserPlanTier, number> = {
	free: 0,
	pro: 1,
	premium: 2,
	global_investor: 3,
};

export function planAtLeast(
	actual: UserPlanTier,
	required: UserPlanTier
): boolean {
	return PLAN_RANK[actual] >= PLAN_RANK[required];
}

export const USER_PLAN_RESOLVER = Symbol('USER_PLAN_RESOLVER');

export interface UserPlanResolverPort {
	/**
	 * Plano efetivo do usuario. Devolve `'free'` quando nao ha assinatura
	 * ativa, quando o plano nao e reconhecido, ou quando a consulta falha —
	 * negar acesso em caso de duvida e o comportamento seguro pra um gate
	 * de feature paga.
	 */
	resolve(userId: string): Promise<UserPlanTier>;
}
