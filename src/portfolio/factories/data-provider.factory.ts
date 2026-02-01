import { Injectable, Logger } from '@nestjs/common';
import { B3ApiAdapter } from 'src/portfolio/adapter/b3-api.adapter';
import { PuppeteerDataAdapter } from 'src/portfolio/adapter/fundamentus.adapter';
import { IDataProvider } from 'src/portfolio/interface/portfolio.interface';

@Injectable()
export class DataProviderFactory {
	private readonly logger = new Logger(DataProviderFactory.name);

	async createProvider(): Promise<IDataProvider> {
		// Try official B3 API first
		if (process.env.B3_API_KEY) {
			const apiAdapter = new B3ApiAdapter();
			if (await apiAdapter.validateConnection()) {
				this.logger.log('Using B3 Official API');
				return apiAdapter;
			}
		}

		// Fall back to Puppeteer web scraping
		const puppeteerAdapter = new PuppeteerDataAdapter();
		if (await puppeteerAdapter.validateConnection()) {
			this.logger.log('Using Puppeteer Web Scraper');
			return puppeteerAdapter;
		}

		throw new Error('No valid data source available');
	}
}
