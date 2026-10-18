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

/**
 * Nível do investidor que define a profundidade do resumo (TRA-256): mesmo
 * vocabulário do `InvestorProfileService`. Ausente vale `intermediate`, o
 * resumo de antes.
 */
export type RiSummaryLevel = 'beginner' | 'intermediate' | 'experienced';

export const DEFAULT_RI_SUMMARY_LEVEL: RiSummaryLevel = 'intermediate';

/** Teto de destaques por nível; o mesmo que o trackerr-ia aplica no prompt. */
export const RI_SUMMARY_MAX_HIGHLIGHTS: Record<RiSummaryLevel, number> = {
	beginner: 3,
	intermediate: 8,
	experienced: 12,
};

export function normalizeRiSummaryLevel(value: unknown): RiSummaryLevel {
	return value === 'beginner' ||
		value === 'experienced' ||
		value === 'intermediate'
		? value
		: DEFAULT_RI_SUMMARY_LEVEL;
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
	/**
	 * `true` so para rotina do servidor cujo documento saiu da propria
	 * descoberta, nunca de corpo de requisicao (TRA-260). Publica o resumo
	 * tambem pela chave do protocolo da CVM — ver `buildProtocolCacheKey`.
	 */
	serverDiscovered?: boolean;
	/**
	 * Por que o texto nao veio, quando nao veio (TRA-253): entra em
	 * `limitations` como `ri_content_<motivo>`, para a tela e o chat dizerem
	 * o que houve (PDF escaneado, arquivo que nao e PDF, fora do ar...).
	 */
	contentUnavailableReason?: string | null;
	/** Profundidade do resumo (TRA-256). Ausente: `intermediate`. */
	level?: RiSummaryLevel;
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
		/** Aditivo (TRA-256): para qual nível o resumo foi escrito. */
		level?: RiSummaryLevel;
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
