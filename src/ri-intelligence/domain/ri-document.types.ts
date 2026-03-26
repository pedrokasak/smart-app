export type RiDocumentType =
	| 'earnings_release'
	| 'investor_presentation'
	| 'material_fact'
	| 'reference_form'
	| 'shareholder_notice'
	| 'other';

export type RiDocumentSourceType = 'url' | 'file';

export interface RiDocumentSource {
	type: RiDocumentSourceType;
	value: string;
}

export interface RiDocumentIngestionInput {
	ticker: string;
	company: string;
	title: string;
	period?: string | null;
	publishedAt: Date | string;
	source: RiDocumentSource;
	documentType?: RiDocumentType | null;
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
		confidence: 'high' | 'medium';
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

