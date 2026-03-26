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
	guidance: RiStructuredSignalItem;
	risks: RiStructuredSignalItem;
	toneShift: RiStructuredSignalItem;
}

export interface RiDocumentSummaryInput {
	document: RiDocumentRecord;
	content: string | null | undefined;
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

