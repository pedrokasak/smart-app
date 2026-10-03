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
	contentStatus: 'metadata_only' | 'extracted';
	/**
	 * Protocolo do documento na CVM (TRA-260): o `numProtocolo` do link de
	 * download do ENET. Identifica o mesmo documento no dataset IPE semanal e
	 * na consulta diaria do ENET (conferido em 25/09/2026: 99 de 99), enquanto
	 * link e titulo mudam de uma fonte para outra. Nao e o `Protocolo_Entrega`
	 * do IPE, que e outro identificador. Ausente em documento de fora da CVM.
	 */
	deliveryProtocol?: string | null;
	/**
	 * Classificacao OFICIAL da CVM (TRA-260), como o documento foi entregue:
	 * categoria ("Fato Relevante", "Comunicado ao Mercado"...) e tipo. Mais
	 * confiavel que `documentType`, que sai de palavra-chave no titulo e
	 * rotula todo comunicado como fato relevante. Para FII, a categoria e o
	 * tipo da FundosNet da B3 (TRA-266). Ausente fora dessas fontes.
	 */
	cvmCategory?: string | null;
	cvmType?: string | null;
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
