export type RiDocumentType =
	| 'earnings_release'
	| 'investor_presentation'
	| 'material_fact'
	| 'reference_form'
	| 'shareholder_notice'
	| 'financial_statement'
	| 'management_report'
	| 'conference_call_material'
	| 'dividend_notice'
	| 'other_ri_document'
	| 'unknown';

export type RiDocumentSourceType = 'url' | 'file';

export interface RiDocumentSource {
	type: RiDocumentSourceType;
	value: string;
}

export interface RiDocumentIngestionInput {
	ticker: string;
	company: string;
	title: string;
	subtitle?: string | null;
	period?: string | null;
	publishedAt: Date | string;
	source: RiDocumentSource;
	documentType?: RiDocumentType | null;
	metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface RiDocumentRecord {
	id: string;
	ticker: string;
	company: string;
	title: string;
	documentType: RiDocumentType;
	period: string | null;
	publishedAt: string;
	source: RiDocumentSource;
	classification: {
		method: 'provided' | 'deterministic_rules';
		confidence: 'high' | 'medium' | 'low';
		score?: number;
		matchedAliases?: string[];
	};
	contentStatus: 'metadata_only';
}

export interface RiDocumentQuery {
	ticker?: string;
	company?: string;
	documentType?: RiDocumentType;
	period?: string;
	dateFrom?: string | Date;
	dateTo?: string | Date;
	limit?: number;
}
