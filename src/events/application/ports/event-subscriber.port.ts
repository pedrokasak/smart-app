import { EventHandler } from 'src/events/domain/domain-event';

/**
 * Assinatura por padrao hierarquico:
 *   'portfolio.dividend.received' — exato
 *   'portfolio.*.received'        — um nivel
 *   'portfolio.**'               — todos os niveis a partir dali
 *   '**'                          — tudo
 *
 * O handler precisa ser idempotente. Em qualquer transporte distribuido o
 * mesmo evento pode chegar duas vezes.
 */
export interface EventSubscriber {
	subscribe(pattern: string, handler: EventHandler): void;
}

export const EVENT_SUBSCRIBER = Symbol('EVENT_SUBSCRIBER');
