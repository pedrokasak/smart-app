import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

export const RI_DOCUMENT_DISCOVERY = Symbol('RI_DOCUMENT_DISCOVERY');

export interface RiDocumentDiscoveryInput {
	ticker: string;
	company: string;
	origin: string;
	/**
	 * Filtro opcional de janela temporal (ISO date). Quando ausente, o adapter
	 * usa seu default interno (ex.: últimos N dias). Aditivo: undefined preserva
	 * o comportamento atual, por isso os adapters existentes continuam compilando.
	 */
	dateFrom?: string | Date;
	dateTo?: string | Date;
}

export interface RiDocumentDiscoveryPort {
	discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]>;
}
