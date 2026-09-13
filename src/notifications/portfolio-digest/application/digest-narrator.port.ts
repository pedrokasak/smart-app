import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

/**
 * Narra os fatos ja decididos pelo NestJS em prosa. Nunca decide o que
 * entra no digest — so como dizer o que ja foi decidido (ver TRA-10).
 * Retorna null quando indisponivel, com timeout, ou quando a resposta
 * falha na validacao (ver digest-narrative-validator.ts) — o chamador cai
 * no template deterministico nesses casos, nunca propaga o erro.
 */
export interface DigestNarratorPort {
	narrate(facts: PortfolioDigestFacts): Promise<string | null>;
}

export const DIGEST_NARRATOR = Symbol('DIGEST_NARRATOR');
