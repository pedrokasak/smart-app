/**
 * Envelope portatil de evento de dominio (TRA-136).
 *
 * O formato segue de proposito o vocabulario do CloudEvents (`id`, `type`,
 * `source`/`producer`, `subject`, `time`/`occurredAt`, `data`/`payload`) para
 * que o mesmo evento trafegue sem traducao quando sair do processo. Hoje o
 * transporte e in-process; amanha pode ser Kafka, NATS ou HTTP — e nenhuma
 * linha de dominio muda.
 *
 * Regra dura: nenhum arquivo em `domain/` ou `application/` importa
 * `@nestjs/event-emitter`, `bullmq` ou `ioredis`. Produtores dependem apenas
 * das portas em `../application/ports`.
 */
export interface DomainEvent<T = unknown> {
	/**
	 * UUID gerado pelo PRODUTOR, nunca pelo transporte. E a chave de
	 * idempotencia: reprocessar o mesmo `id` nao pode gerar efeito duplicado.
	 * Gerar na origem tambem e o que permite o padrao de outbox transacional
	 * mais adiante — o evento ja nasce identificado dentro da transacao.
	 */
	id: string;
	/** Nome hierarquico do evento, ex.: 'portfolio.dividend.received'. */
	type: string;
	/** Versionamento de schema do `payload`. Comeca em 1. */
	version: number;
	/** ISO-8601 do instante em que o fato ocorreu (nao do publish). */
	occurredAt: string;
	/** Quem produziu, ex.: 'server.dividends'. */
	producer: string;
	/** userId. Futura chave de particao quando o transporte sair do processo. */
	subject: string;
	/** Correlaciona eventos de um mesmo fluxo/request. */
	correlationId?: string;
	/** Id do evento que originou este. */
	causationId?: string;
	payload: T;
}

/**
 * Assinatura de qualquer consumidor. Deve ser idempotente: em transporte
 * distribuido o mesmo evento pode chegar duas vezes.
 */
export type EventHandler<T = unknown> = (
	event: DomainEvent<T>
) => void | Promise<void>;

/** Separador de niveis do `type`. Usado tambem no casamento de padrao. */
export const EVENT_TYPE_SEPARATOR = '.';

/** Curinga de um unico nivel no padrao de assinatura. */
export const EVENT_PATTERN_SINGLE_WILDCARD = '*';

/** Curinga de multiplos niveis (apenas no fim do padrao). */
export const EVENT_PATTERN_MULTI_WILDCARD = '**';
