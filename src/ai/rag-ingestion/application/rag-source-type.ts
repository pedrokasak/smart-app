/**
 * Tipos de fonte de um chunk de RAG (TRA-84).
 *
 * Fonte única de verdade no server, que é o PRODUTOR dos chunks. Sem um enum
 * central, `source_type` vira string livre e a mesma tabela acumula
 * `portfolio_risk` / `portfolioRisk` / `risk` — a taxonomia se corrompe em
 * silêncio.
 *
 * Só entram tipos com produtor determinístico existente. `portfolio_tax`
 * (base fiscal, travada em revisão de contador), `portfolio_goal` e
 * `portfolio_insight` (sem produtor) ficam de fora de propósito: categoria
 * sem produtor é categoria vazia fingindo cobertura.
 */
export const RAG_SOURCE_TYPES = [
	'portfolio_position',
	'portfolio_risk',
	'portfolio_performance',
	'portfolio_dividend',
] as const;

export type RagSourceType = (typeof RAG_SOURCE_TYPES)[number];

export function isRagSourceType(value: string): value is RagSourceType {
	return (RAG_SOURCE_TYPES as readonly string[]).includes(value);
}
