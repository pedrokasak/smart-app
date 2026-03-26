import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

export const RI_DOCUMENT_DISCOVERY = Symbol('RI_DOCUMENT_DISCOVERY');

export interface RiDocumentDiscoveryInput {
	ticker: string;
	company: string;
	origin: string;
}

export interface RiDocumentDiscoveryPort {
	discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]>;
}
