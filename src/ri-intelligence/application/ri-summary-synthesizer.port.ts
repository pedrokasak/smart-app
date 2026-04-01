import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { RiStructuredSignals } from 'src/ri-intelligence/application/ri-summary.types';

export interface RiSummarySynthesisInput {
	document: RiDocumentRecord;
	content: string;
	structuredSignals: RiStructuredSignals;
}

export interface RiSummarySynthesisOutput {
	highlights: string[];
	narrative: string;
	metadata?: {
		model?: string;
		tokenUsage?: number;
	};
}

export interface RiSummarySynthesizerPort {
	summarize(input: RiSummarySynthesisInput): Promise<RiSummarySynthesisOutput>;
}

export const RI_SUMMARY_SYNTHESIZER = Symbol('RI_SUMMARY_SYNTHESIZER');
