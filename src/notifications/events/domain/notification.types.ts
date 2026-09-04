/**
 * Tipos de evento suportados pelo NotificationsService.
 *
 * Cada tipo mapeia 1:1 para uma chave em `User.notificationPreferences.email`
 * e `.push`. Adicionar um tipo aqui exige:
 *   1. atualizar o schema do usuario (defaults)
 *   2. tratar o payload no builder de template do canal
 *   3. cobrir com teste unitario
 */
export enum NotificationType {
	DividendReceived = 'dividendReceived',
	AllocationBreached = 'allocationBreached',
	AiInsightHigh = 'aiInsightHigh',
	QuoteStale = 'quoteStale',
	SubscriptionExpiring = 'subscriptionExpiring',
}

export enum NotificationChannelName {
	Email = 'email',
	Push = 'push',
}

export enum NotificationDeliveryStatus {
	Pending = 'pending',
	Sent = 'sent',
	Failed = 'failed',
	Skipped = 'skipped',
}

/**
 * Payload por tipo de evento. Nunca opaco: cada campo alimenta template.
 * Manter em uniao discriminada evita `any` no service.
 */
export type NotificationPayload =
	| {
			type: NotificationType.DividendReceived;
			symbol: string;
			amount: number;
			currency?: string; // default BRL
			receivedAt?: string; // ISO date
	  }
	| {
			type: NotificationType.AllocationBreached;
			bucket: 'stocks' | 'crypto' | 'fiis' | 'other';
			targetPct: number;
			actualPct: number;
	  }
	| {
			type: NotificationType.AiInsightHigh;
			title: string;
			summary: string;
			insightId?: string;
	  }
	| {
			type: NotificationType.QuoteStale;
			symbol: string;
			minutesSinceLastQuote: number;
	  }
	| {
			type: NotificationType.SubscriptionExpiring;
			planName: string;
			expiresAt: string; // ISO date
			daysUntilExpiration: number;
	  };

/**
 * Defaults por tipo. Criticos (assinatura expirando, insight IA de alta
 * prioridade) vem ligados; ruidosos vem desligados — o usuario pode virar
 * a chave nas preferencias.
 */
export const DEFAULT_EMAIL_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: false,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
};

export const DEFAULT_PUSH_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: false,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
};

export const DEDUPE_WINDOW_HOURS = 24;
