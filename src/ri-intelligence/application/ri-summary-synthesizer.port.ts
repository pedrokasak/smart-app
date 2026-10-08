import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	RiStructuredSignals,
	RiSummaryCitation,
} from 'src/ri-intelligence/application/ri-summary.types';

export interface RiSummarySynthesisInput {
	document: RiDocumentRecord;
	content: string;
	structuredSignals: RiStructuredSignals;
}

export interface RiSummarySynthesisOutput {
	highlights: string[];
	narrative: string;
	citations?: RiSummaryCitation[];
	metadata?: {
		model?: string;
		tokenUsage?: number;
	};
}

/**
 * Por que o resumo por IA não saiu (TRA-275). Os dois casos pedem ações
 * diferentes: `provider_unavailable` é infraestrutura (cota, modelo
 * inexistente, timeout) e resolve com configuração; `rejected` é o guardrail
 * barrando a saída do modelo, e um retry não ajuda.
 */
export type RiSummaryFailureKind = 'provider_unavailable' | 'rejected';

export class RiSummarySynthesisError extends Error {
	constructor(
		readonly kind: RiSummaryFailureKind,
		/** Motivo curto e seguro para log: nunca contém texto do documento. */
		readonly reason: string,
		readonly status: number | null = null
	) {
		super(`${kind}:${reason}`);
		this.name = 'RiSummarySynthesisError';
	}
}

export interface RiSummarySynthesizerPort {
	summarize(input: RiSummarySynthesisInput): Promise<RiSummarySynthesisOutput>;
}

export const RI_SUMMARY_SYNTHESIZER = Symbol('RI_SUMMARY_SYNTHESIZER');
