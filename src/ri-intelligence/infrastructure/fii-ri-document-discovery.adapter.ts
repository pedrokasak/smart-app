import { Injectable, Logger } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { PuppeteerRiDocumentDiscoveryAdapter } from './puppeteer-ri-document-discovery.adapter';

@Injectable()
export class FiiRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly logger = new Logger(FiiRiDocumentDiscoveryAdapter.name);

	constructor(private readonly puppeteerAdapter: PuppeteerRiDocumentDiscoveryAdapter) {}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		this.logger.log(`Consulting FII specific sources for: ${input.ticker}`);
		const statusInvestUrl = `https://statusinvest.com.br/fii/${input.ticker.toLowerCase()}`;
		const fundsExplorerUrl = `https://www.fundsexplorer.com.br/funds/${input.ticker.toLowerCase()}`;

		try {
			const siDocuments = await this.puppeteerAdapter.discover({ ...input, origin: statusInvestUrl });
			if (siDocuments.length > 0) return siDocuments;
		} catch (error) {
			this.logger.warn(`Failed to discover FII documents on StatusInvest for ${input.ticker}`);
		}

		try {
			const feDocuments = await this.puppeteerAdapter.discover({ ...input, origin: fundsExplorerUrl });
			return feDocuments;
		} catch (error) {
			this.logger.warn(`Failed to discover FII documents on FundsExplorer for ${input.ticker}`);
			return [];
		}
	}
}
