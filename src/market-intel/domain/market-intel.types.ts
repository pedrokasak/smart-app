/**
 * Tipos de domínio do agente de inteligência de mercado (ADR-004, F1).
 *
 * Notícias são contexto interno do RAG — nunca expostas ao usuário.
 * Só o plano Wealth recebe enriquecimento por notícias.
 */

/** Camada da fonte conforme ADR-004 seção 6. */
export type SourceLayer = 'A' | 'B';

/** Fonte de RSS cadastrada. */
export interface MarketSource {
	id: string;
	name: string;
	feedUrl: string;
	layer: SourceLayer;
	enabled: boolean;
	/** Domínio canônico para robots.txt e rate limit. */
	domain: string;
	/** Última vez que o ETag foi verificado. */
	lastFetchedAt: Date | null;
	/** ETag da última resposta do feed. */
	etag: string | null;
	/** Last-Modified da última resposta. */
	lastModified: string | null;
}

/** Status de processamento de um item de notícia. */
export type NewsItemStatus =
	| 'pending'
	| 'analyzed'
	| 'skipped'
	| 'failed'
	| 'duplicate';

/** Item bruto ingerido de um feed RSS. */
export interface MarketNewsItem {
	/** SHA-256 da URL canônica (dedup primário). */
	urlHash: string;
	/** SHA-256 do conteúdo normalizado (dedup secundário). */
	contentHash: string;
	/** SimHash de 64 bits como BigInt string (dedup por similaridade). */
	simHash: string;
	/** ID da fonte. */
	sourceId: string;
	/** Camada da fonte no momento da ingestão. */
	layer: SourceLayer;
	title: string;
	/** Máx 300 chars para camada B; texto completo para camada A. */
	description: string;
	url: string;
	publishedAt: Date;
	author: string | null;
	/** Palavras normalizadas para SimHash. */
	tokens: string[];
	status: NewsItemStatus;
	/** ID da story à qual este item foi clusterizado. */
	storyId: string | null;
	discoveredAt: Date;
	analyzedAt: Date | null;
	lastError: string | null;
}

/** Cluster de itens similares sobre o mesmo evento. */
export interface MarketStory {
	/** Hash do item semente (primeiro do cluster). */
	seedUrlHash: string;
	/** SimHash do item semente para comparação de novos items. */
	seedSimHash: string;
	/** Título representativo (do item semente). */
	title: string;
	/** IDs dos itens membros. */
	memberUrlHashes: string[];
	/** Data do item mais recente no cluster. */
	latestAt: Date;
	/** Data do item mais antigo no cluster. */
	earliestAt: Date;
	/** Se já foi enviado para análise no trackerr-ia. */
	indexedAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

/** Resultado de uma rodada de ingestão. */
export interface MarketIngestRun {
	startedAt: Date;
	finishedAt: Date | null;
	sourcesTotal: number;
	sourcesFetched: number;
	sourcesFailed: number;
	itemsFound: number;
	itemsNew: number;
	itemsDuplicate: number;
	storiesCreated: number;
	storiesMerged: number;
	errors: string[];
}
