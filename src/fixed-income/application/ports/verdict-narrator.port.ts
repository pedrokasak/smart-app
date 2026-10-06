import type { VerdictFacts } from '../verdict-facts';

export const VERDICT_NARRATOR = Symbol('VERDICT_NARRATOR');

/**
 * Escreve o veredito do comparador em prosa a partir de fatos já calculados.
 * Devolve `null` quando a IA está indisponível, estoura o tempo ou responde
 * algo inutilizável — nunca lança: o chamador cai no texto determinístico.
 */
export interface VerdictNarratorPort {
	narrate(facts: VerdictFacts): Promise<string | null>;
}
