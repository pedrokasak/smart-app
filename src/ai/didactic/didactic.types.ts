import type { SophisticationLevel } from 'src/intelligence/application/investor-profile/investor-profile.types';

/**
 * Resposta didática do Copiloto (docs/requisitos/ia-didatica.md): a resposta
 * direta, o que o número significa, por que importa, as opções (nunca uma
 * ordem), os termos usados e as perguntas para continuar aprendendo.
 * Tudo montado de forma determinística a partir dos dados do orquestrador.
 */
export const DIDACTIC_LEVELS = [
	'iniciante',
	'intermediario',
	'avancado',
] as const;
export type DidacticLevel = (typeof DIDACTIC_LEVELS)[number];

export interface DidacticTerm {
	term: string;
	definition: string;
}

export interface DidacticAnswer {
	level: DidacticLevel;
	/** Uma frase que responde a pergunta, com o número e a referência dele. */
	answer: string;
	/** O conceito no nível da pessoa, com o número dela. No avançado é a leitura técnica. */
	meaning: string | null;
	/** A consequência concreta, em reais quando dá. */
	whyItMatters: string | null;
	/** Opções, nunca uma ordem; vazia quando a pergunta não pede ação. */
	options: string[];
	terms: DidacticTerm[];
	/** Perguntas que o próprio Copiloto sabe responder. */
	followUps: string[];
}

const LEVEL_BY_SOPHISTICATION: Record<SophisticationLevel, DidacticLevel> = {
	beginner: 'iniciante',
	intermediate: 'intermediario',
	experienced: 'avancado',
};

/** Sem perfil, o meio-termo: termo técnico com definição curta. */
export function didacticLevelFrom(
	sophistication: SophisticationLevel | null | undefined
): DidacticLevel {
	return (
		(sophistication && LEVEL_BY_SOPHISTICATION[sophistication]) ||
		'intermediario'
	);
}
