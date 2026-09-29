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
	/** Fato relevante de empresa em carteira (TRA-261). */
	RiMaterialFact = 'riMaterialFact',
	/** Outro documento relevante de empresa em carteira (TRA-261). */
	RiDocument = 'riDocument',
}

/**
 * Avisos que saem por e-mail mesmo com a chave geral "Notificações por
 * e-mail" desligada (TRA-244): dizem respeito à cobrança da conta, não são
 * conteúdo. A preferência por tipo continua valendo para eles.
 */
export const ESSENTIAL_EMAIL_TYPES: ReadonlySet<NotificationType> = new Set([
	NotificationType.SubscriptionExpiring,
]);

export enum NotificationChannelName {
	Email = 'email',
	Push = 'push',
}

export enum NotificationDeliveryStatus {
	Pending = 'pending',
	Sent = 'sent',
	Failed = 'failed',
	Skipped = 'skipped',
	/**
	 * O canal aceitou a notificacao mas nao entrega agora (TRA-136, fase 6).
	 *
	 * Existe por causa do push, que e DIARIO e AGREGADO: no instante do
	 * evento o que se decide e "esta notificacao entra no resumo de hoje?",
	 * nao "mandar agora". Reaproveitar `Sent` ali seria mentir no doc
	 * auditavel; reaproveitar `Skipped` apagaria a diferenca entre "o
	 * usuario desligou este aviso" e "vai sair no resumo".
	 */
	Deferred = 'deferred',
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
			/** ISO da ultima leitura bem-sucedida. O template mostra a data. */
			lastQuoteAt: string;
	  }
	| {
			type: NotificationType.SubscriptionExpiring;
			planName: string;
			expiresAt: string; // ISO date
			daysUntilExpiration: number;
	  }
	| RiDocumentNotificationPayload;

/** Documento de RI de empresa em carteira (TRA-261). */
export type RiDocumentNotificationPayload = {
	type: NotificationType.RiMaterialFact | NotificationType.RiDocument;
	ticker: string;
	company: string;
	title: string;
	publishedAt: string; // ISO date
	/** Link oficial do documento na CVM. */
	sourceUrl: string;
	/** Destaques verificados, so para quem tem `ri.ai_summary`. */
	highlights?: string[];
};

/**
 * Defaults por tipo. Criticos (assinatura expirando, insight IA de alta
 * prioridade) vem ligados; ruidosos vem desligados — o usuario pode virar
 * a chave nas preferencias.
 *
 * TRA-136 fase 7: `allocationBreached` e `portfolioScoreDropped` VIRAM
 * para `true`. Estavam desligados porque, sem motor de limiares, uma
 * carteira 0,4pp fora da meta viraria e-mail — e viraria de novo todo dia,
 * porque a condicao continua verdadeira. O motor entregue na fase 4 (banda
 * de tolerancia, borda de subida, histerese e cooldown de 72h) removeu
 * exatamente esse risco: uma condicao de pe rende, no maximo, um aviso a
 * cada 72h.
 *
 * A virada NAO reativa quem optou por sair. Estes valores so sao
 * consultados quando o campo esta AUSENTE no doc do usuario: o schema usa
 * `default: undefined` por evento (ver `user.model.ts`) e
 * `NotificationsService.userAllows` testa `typeof value === 'boolean'`
 * antes de cair aqui. Um `false` gravado pelo usuario e um valor presente,
 * e continua ganhando do default. Coberto por teste em
 * `notifications.service.spec.ts`.
 */
export const DEFAULT_EMAIL_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: true,
	[NotificationType.PortfolioScoreDropped]: true,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
	// TRA-261: e-mail so para fato relevante — raro (9 no mercado inteiro em
	// 28/09/2026) e o que o investidor quer saber na hora. Os outros
	// documentos relevantes foram 69 no mesmo dia: por e-mail, virariam spam
	// e empurrariam o usuario para a chave geral, que desliga tudo.
	[NotificationType.RiMaterialFact]: true,
	[NotificationType.RiDocument]: false,
};

export const DEFAULT_PUSH_PREFS: Record<NotificationType, boolean> = {
	[NotificationType.DividendReceived]: false,
	[NotificationType.AllocationBreached]: true,
	[NotificationType.PortfolioScoreDropped]: true,
	[NotificationType.AiInsightHigh]: true,
	[NotificationType.QuoteStale]: false,
	[NotificationType.SubscriptionExpiring]: true,
	// Push e o resumo diario agregado: volume nao vira ruido.
	[NotificationType.RiMaterialFact]: true,
	[NotificationType.RiDocument]: true,
};

export const DEDUPE_WINDOW_HOURS = 24;
