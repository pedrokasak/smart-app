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
	| 'ai.insights'
	| 'fiscal.darf'
	| 'reports.export'
	| 'risk.analytics'
	| 'policy.investment'
	| 'research.comparator'
	| 'ri.ai_summary';

export const ALL_PLAN_CAPABILITIES: PlanCapability[] = [
	'fiscal.ir_report',
	'broker.sync',
	'ai.rag',
	'ai.insights',
	'fiscal.darf',
	'reports.export',
	'risk.analytics',
	'policy.investment',
	'research.comparator',
	'ri.ai_summary',
];

/**
 * As capabilities que existiam quando `capabilities` passou a ser gravado no
 * plano (TRA-189). Plano configurado antes de `capabilitiesKnown` existir
 * decidiu sobre ESTAS e só estas (TRA-193).
 */
export const LEGACY_PLAN_CAPABILITIES: readonly PlanCapability[] = [
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
	'fiscal.darf': 'Módulo fiscal com DARF',
	'reports.export': 'Relatórios exportáveis (PDF/XLSX) e envio agendado',
	'risk.analytics': 'VaR, Sharpe, beta e atribuição de risco',
	'policy.investment': 'Política de investimento',
	'research.comparator': 'Comparador de ativos lado a lado',
	'ri.ai_summary': 'Resumo por IA de documentos de RI',
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
	// Patamares tirados do que os cards de plano já prometem (TRA-194).
	'fiscal.darf': PREMIUM_ACCESS_LEVEL,
	'reports.export': PRO_ACCESS_LEVEL,
	'risk.analytics': PREMIUM_ACCESS_LEVEL,
	'policy.investment': PREMIUM_ACCESS_LEVEL,
	// Sem rota própria: o comparador monta a tabela no cliente com a mesma
	// cotação por ativo que o Research grátis já expõe (TRA-200). A trava é
	// de UX, lida pelo web via `capabilities`.
	'research.comparator': PRO_ACCESS_LEVEL,
	'ri.ai_summary': PREMIUM_ACCESS_LEVEL,
};

/**
 * Decide se o plano libera `capability`.
 *
 * A lista `capabilities` do plano só manda sobre as capabilities que o admin
 * ENXERGAVA quando a gravou (`capabilitiesKnown`). Sem isto, criar uma
 * capability nova (ex.: `fiscal.darf`) revogaria o acesso dela em todo plano
 * já configurado — a chave nova não está na lista porque não existia quando
 * o admin marcou os checkboxes, e "ausente" viraria "negado" para quem paga.
 *
 * Três casos:
 *   - admin decidiu sobre esta capability  -> a lista manda (inclusive negar);
 *   - plano nunca configurado (lista vazia) -> patamar padrão por `tier`;
 *   - capability mais nova que a configuração -> patamar padrão por `tier`,
 *     até o admin salvar o plano de novo e decidir sobre ela.
 *
 * `known` ausente com lista preenchida = plano gravado antes deste campo
 * existir: vale `LEGACY_PLAN_CAPABILITIES`.
 */
export function planHasCapability(
	capabilities: string[] | null | undefined,
	capability: PlanCapability,
	tier: UserPlanTier,
	known?: readonly string[] | null
): boolean {
	const configured = Array.isArray(capabilities) && capabilities.length > 0;
	if (configured) {
		const decidedOn = known?.length ? known : LEGACY_PLAN_CAPABILITIES;
		if (decidedOn.includes(capability)) {
			return capabilities.includes(capability);
		}
	}
	return planAtLeast(tier, CAPABILITY_DEFAULT_LEVEL[capability]);
}

/** O que o gate precisa saber sobre o plano do usuário. */
export interface PlanAccess {
	tier: UserPlanTier;
	capabilities: string[];
	/** Capabilities sobre as quais o admin decidiu ao salvar o plano. */
	capabilitiesKnown?: string[];
}

/** Capabilities que o plano libera de fato — mesma regra do gate. */
export function effectiveCapabilities(access: PlanAccess): PlanCapability[] {
	return ALL_PLAN_CAPABILITIES.filter((capability) =>
		planHasCapability(
			access.capabilities,
			capability,
			access.tier,
			access.capabilitiesKnown
		)
	);
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
	resolveWithCapabilities(userId: string): Promise<PlanAccess>;
}
