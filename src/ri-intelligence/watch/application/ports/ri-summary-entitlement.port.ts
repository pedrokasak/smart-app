/**
 * Quem pode ler o resumo por IA de documento de RI (TRA-261): a capability
 * `ri.ai_summary`, a mesma que trava a tela e o chat. O aviso leva os
 * destaques so para esses usuarios; os demais recebem titulo, data e link.
 */
export interface RiSummaryEntitlement {
	/** O subconjunto de `userIds` com direito. Na duvida, nega. */
	usersWithAiSummary(userIds: string[]): Promise<Set<string>>;
}

export const RI_SUMMARY_ENTITLEMENT = Symbol('RI_SUMMARY_ENTITLEMENT');
