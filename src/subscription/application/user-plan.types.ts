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

/**
 * Chave estavel de feature paga (TRA-189) — separada do texto de vitrine em
 * `plan.features`. Renomear a feature na landing nunca muda quem tem acesso;
 * so mexer aqui muda.
 */
export type PlanCapability =
	| 'fiscal.ir_report'
	| 'broker.sync'
	| 'ai.rag'
	| 'ai.insights';

export const ALL_PLAN_CAPABILITIES: PlanCapability[] = [
	'fiscal.ir_report',
	'broker.sync',
	'ai.rag',
	'ai.insights',
];

/** Rotulo exibido no checkbox do painel admin e no card do plano. */
export const PLAN_CAPABILITY_LABELS: Record<PlanCapability, string> = {
	'fiscal.ir_report': 'Relatório de Imposto de Renda',
	'broker.sync': 'Sincronização direta com corretora',
	'ai.rag': 'Copiloto com busca em base de conhecimento (RAG)',
	'ai.insights': 'Radar de oportunidades e IA Insights',
};

/**
 * Patamar de `accessLevel` que cada capability libera quando o plano NUNCA
 * teve `capabilities` configurado pelo admin — mesma trava de hoje, sem
 * regressao pra plano que ainda nao passou pelo painel novo (TRA-189).
 */
export const CAPABILITY_DEFAULT_LEVEL: Record<PlanCapability, UserPlanTier> = {
	'fiscal.ir_report': PRO_ACCESS_LEVEL,
	'broker.sync': PRO_ACCESS_LEVEL,
	'ai.rag': PRO_ACCESS_LEVEL,
	'ai.insights': PREMIUM_ACCESS_LEVEL,
};

/**
 * `true` quando o admin configurou `capabilities` no plano e a lista inclui
 * a chave — nesse caso o checkbox do painel manda, mesmo que contrarie o
 * `accessLevel` numerico. Plano que nunca teve `capabilities` definido (lista
 * ausente ou vazia) cai no patamar padrao de hoje via `tier`, pra nao
 * regredir quem nunca abriu o painel novo.
 */
export function planHasCapability(
	capabilities: string[] | null | undefined,
	capability: PlanCapability,
	tier: UserPlanTier
): boolean {
	if (Array.isArray(capabilities) && capabilities.length > 0) {
		return capabilities.includes(capability);
	}
	return planAtLeast(tier, CAPABILITY_DEFAULT_LEVEL[capability]);
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

	/**
	 * Mesma resolucao de `resolve()`, mais as `capabilities` explicitas do
	 * plano (TRA-189) — numa unica consulta, pra quem precisa gatear por
	 * capability em vez de so por nivel. Capabilities vazio no retorno so
	 * significa "plano nao configurado com capabilities"; o fallback por
	 * nivel e responsabilidade de `planHasCapability`, nao deste metodo.
	 */
	resolveWithCapabilities(
		userId: string
	): Promise<{ tier: UserPlanTier; capabilities: string[] }>;
}
