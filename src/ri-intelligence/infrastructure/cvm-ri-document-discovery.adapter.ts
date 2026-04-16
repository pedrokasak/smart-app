import { Injectable, Logger } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

@Injectable()
export class CvmRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly logger = new Logger(CvmRiDocumentDiscoveryAdapter.name);

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		// Mock implementation for CVM ENET. 
		// Real implementation would parse https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/
		// For now, it delegates to the fallback (Puppeteer) primarily by returning empty if not found easily in cache
		this.logger.log(`Consulting CVM database for ticker: ${input.ticker}`);
		return [];
	}
}
