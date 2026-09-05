import { NotificationType } from 'src/notifications/events/domain/notification.types';

/**
 * Registro unico dos tipos de evento de dominio (TRA-136).
 *
 * Existe para que `type` nunca seja string magica espalhada pelo codigo.
 * Os produtores destes eventos chegam na fase 3; o contrato vem antes de
 * proposito — assim a fila, o motor de limiares e os consumidores ja podem
 * ser escritos e testados contra nomes estaveis.
 *
 * Convencao do nome: `<contexto>.<agregado>.<fato-no-passado>`.
 */
export const DOMAIN_EVENT_TYPES = {
	DividendReceived: 'portfolio.dividend.received',
	AllocationBreached: 'portfolio.allocation.breached',
	AiInsightHighPriority: 'ai.insight.high_priority',
	QuoteStale: 'market.quote.stale',
	SubscriptionExpiring: 'subscription.expiring',
} as const;

export type DomainEventType =
	(typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

export const DOMAIN_EVENT_TYPE_LIST: readonly DomainEventType[] =
	Object.values(DOMAIN_EVENT_TYPES);

export function isDomainEventType(value: string): value is DomainEventType {
	return (DOMAIN_EVENT_TYPE_LIST as readonly string[]).includes(value);
}

/**
 * Ponte entre o tipo de evento (contrato do barramento) e o tipo de
 * notificacao (preferencia do usuario, ja entregue na #134). Fica aqui, e
 * nao no NotificationsService, para que o dominio de notificacao continue
 * sem saber que existe barramento.
 */
export const DOMAIN_EVENT_TO_NOTIFICATION_TYPE: Record<
	DomainEventType,
	NotificationType
> = {
	[DOMAIN_EVENT_TYPES.DividendReceived]: NotificationType.DividendReceived,
	[DOMAIN_EVENT_TYPES.AllocationBreached]: NotificationType.AllocationBreached,
	[DOMAIN_EVENT_TYPES.AiInsightHighPriority]: NotificationType.AiInsightHigh,
	[DOMAIN_EVENT_TYPES.QuoteStale]: NotificationType.QuoteStale,
	[DOMAIN_EVENT_TYPES.SubscriptionExpiring]:
		NotificationType.SubscriptionExpiring,
};

/**
 * Payloads por tipo de evento. Mantidos explicitos (nunca `any`) para que o
 * produtor da fase 3 e o consumidor recebam o mesmo shape checado em compile
 * time. `version` do envelope cobre a evolucao destes shapes.
 */
export interface DividendReceivedPayload {
	symbol: string;
	amount: number;
	currency?: string;
	receivedAt?: string;
}

export interface AllocationBreachedPayload {
	bucket: 'stocks' | 'crypto' | 'fiis' | 'other';
	targetPct: number;
	actualPct: number;
}

export interface AiInsightHighPriorityPayload {
	title: string;
	summary: string;
	insightId?: string;
}

/**
 * TODO(TRA-136): SEM PRODUTOR. Nao existe, hoje, sinal confiavel de
 * "cotacao parada" no servidor.
 *
 * O que foi verificado na fase 3:
 *   - `MarketDataProviderPort`/`TrackerrMarketDataFacade` buscam cotacao sob
 *     demanda e nao guardam o instante da ultima leitura;
 *   - `Asset.lastEnrichedAt` e o unico carimbo de tempo de mercado
 *     persistido, e so e escrito por `PortfolioEnrichService.enrichAsset`,
 *     que hoje roda quando o ativo entra na carteira — nao ha job periodico
 *     de refresh de cotacao;
 *   - a guarda de frescor entregue na TRA-92 vive no front.
 *
 * Usar `lastEnrichedAt` como se fosse "ultima cotacao" dispararia o alerta
 * para todo ativo um dia depois de cadastrado, o que e falso: o dado nao
 * esta velho, e que nunca houve segunda leitura. Inventar o sinal seria
 * pior que nao ter o evento.
 *
 * Para ligar o produtor e preciso, antes, uma das duas coisas: um job de
 * refresh de cotacao que grave o instante da leitura por simbolo, ou o
 * provider expondo `asOf` no snapshot. Qualquer uma das duas fecha o
 * buraco e o produtor vira poucas linhas — o contrato abaixo ja esta
 * pronto, e o consumidor de notificacao ja trata este tipo.
 */
export interface QuoteStalePayload {
	symbol: string;
	minutesSinceLastQuote: number;
}

export interface SubscriptionExpiringPayload {
	planName: string;
	expiresAt: string;
	daysUntilExpiration: number;
}

export interface DomainEventPayloadMap {
	[DOMAIN_EVENT_TYPES.DividendReceived]: DividendReceivedPayload;
	[DOMAIN_EVENT_TYPES.AllocationBreached]: AllocationBreachedPayload;
	[DOMAIN_EVENT_TYPES.AiInsightHighPriority]: AiInsightHighPriorityPayload;
	[DOMAIN_EVENT_TYPES.QuoteStale]: QuoteStalePayload;
	[DOMAIN_EVENT_TYPES.SubscriptionExpiring]: SubscriptionExpiringPayload;
}

/** Versao corrente do schema de cada evento. Subir ao quebrar o payload. */
export const DOMAIN_EVENT_VERSIONS: Record<DomainEventType, number> = {
	[DOMAIN_EVENT_TYPES.DividendReceived]: 1,
	[DOMAIN_EVENT_TYPES.AllocationBreached]: 1,
	[DOMAIN_EVENT_TYPES.AiInsightHighPriority]: 1,
	[DOMAIN_EVENT_TYPES.QuoteStale]: 1,
	[DOMAIN_EVENT_TYPES.SubscriptionExpiring]: 1,
};
