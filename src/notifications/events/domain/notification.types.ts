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
	PortfolioScoreDropped = 'portfolioScoreDropped',
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
			type: NotificationType.PortfolioScoreDropped;
			score: number;
			previousScore: number;
			dropPoints: number;
			maxScore: number;
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
 *
 * TRA-136 fase 4: `allocationBreached` e `portfolioScoreDropped` passam a
 * ser moderados pelo motor de limiares (banda, borda e cooldown), que era
 * exatamente o motivo de estarem desligados. Ligar por padrao ja e seguro,
 * mas e uma mudanca de comportamento para a base inteira de usuarios e nao
 * cabe nesta entrega — fica como virada de uma linha, deliberadamente fora
 * deste PR.
 */
export const DEFAULT_EMAIL_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: false,
	[NotificationType.PortfolioScoreDropped]: false,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
};

export const DEFAULT_PUSH_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: false,
	[NotificationType.PortfolioScoreDropped]: false,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
};

export const DEDUPE_WINDOW_HOURS = 24;
