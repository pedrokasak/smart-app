import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

export interface RiStructuredSignalItem {
	detected: boolean;
	direction: 'up' | 'down' | 'neutral' | 'unknown';
	evidence: string[];
}

export interface RiStructuredSignals {
	revenue: RiStructuredSignalItem;
	profit: RiStructuredSignalItem;
	margin: RiStructuredSignalItem;
	indebtedness: RiStructuredSignalItem;
	capex: RiStructuredSignalItem;
	guidance: RiStructuredSignalItem;
	risks: RiStructuredSignalItem;
	toneShift: RiStructuredSignalItem;
}

export interface RiDocumentSummaryInput {
	document: RiDocumentRecord;
	content: string | null | undefined;
	/**
	 * `false` quando quem chama nao tem a capability `ri.ai_summary` (TRA-238):
	 * devolve so o resumo estruturado, sem ler cache nem chamar IA. Ausente
	 * vale `true` — a rota HTTP ja e travada pelo `@RequiresCapability`.
	 */
	allowAi?: boolean;
}

/**
 * O que sustenta um destaque do resumo por IA (TRA-239). O trackerr-ia so
 * aprova destaque cujo trecho existe no documento e contem os numeros
 * citados; `excerpt` e o texto do PROPRIO documento, nao a copia do modelo.
 */
export interface RiSummaryCitation {
	highlight: string;
	excerpt: string;
	/** Calculada pelos marcadores do PDF; `null` quando o texto nao os tem. */
	page: number | null;
}

export interface RiDocumentSummaryOutput {
	document: {
		id: string;
		ticker: string;
		company: string;
		documentType: RiDocumentRecord['documentType'];
		period: string | null;
		publishedAt: string;
	};
	summary: {
		status: 'ai_generated' | 'insufficient_content' | 'ai_failed' | 'cached_ai';
		highlights: string[];
		narrative: string | null;
		limitations: string[];
		sourceLabel: 'ai_summary' | 'structured_fallback';
		/** Aditivo (TRA-239): uma citacao por destaque, na mesma ordem. */
		citations?: RiSummaryCitation[];
	};
	structuredSignals: RiStructuredSignals;
	cache: {
		key: string | null;
		hit: boolean;
		ttlSeconds: number | null;
	};
	cost: {
		aiCalls: number;
		tokenUsageEstimate: number;
	};
}
