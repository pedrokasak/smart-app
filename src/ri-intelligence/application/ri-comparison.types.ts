import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

export interface RiKeyMetricsSnapshot {
	revenue?: number | null;
	profit?: number | null;
	margin?: number | null;
	indebtedness?: number | null;
}

export interface RiComparableDocumentInput {
	document: RiDocumentRecord;
	content?: string | null;
	keyMetrics?: RiKeyMetricsSnapshot;
}

export interface RiDocumentComparisonInput {
	current: RiComparableDocumentInput;
	previous?: RiComparableDocumentInput | null;
}

export interface RiKeyMetricDiff {
	metric: keyof RiKeyMetricsSnapshot;
	current: number;
	previous: number;
	delta: number;
	direction: 'up' | 'down' | 'stable';
}

export interface RiDocumentComparisonOutput {
	status:
		| 'compared'
		| 'no_previous_document'
		| 'incompatible_documents'
		| 'ai_failed';
	compatible: boolean;
	reasons: string[];
	documents: {
		current: {
			id: string;
			ticker: string;
			documentType: RiDocumentRecord['documentType'];
			period: string | null;
			publishedAt: string;
		};
		previous: {
			id: string;
			ticker: string;
			documentType: RiDocumentRecord['documentType'];
			period: string | null;
			publishedAt: string;
		} | null;
	};
	differences: {
		keyNumbers: RiKeyMetricDiff[];
		guidance: 'improved' | 'worsened' | 'stable' | 'unknown';
		risks: 'improved' | 'worsened' | 'stable' | 'unknown';
		strategy: 'changed' | 'unchanged' | 'unknown';
		tone: 'more_optimistic' | 'more_cautious' | 'stable' | 'unknown';
	};
	synthesis: {
		mode: 'ai' | 'fallback' | 'none';
		highlights: string[];
		narrative: string | null;
		limitations: string[];
	};
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
