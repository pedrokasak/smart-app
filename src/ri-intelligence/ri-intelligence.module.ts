import { Module } from '@nestjs/common';
import { StockModule } from 'src/stocks/stocks.module';
import { RI_ASSET_AUTOCOMPLETE } from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RI_DOCUMENT_DISCOVERY } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RI_DOCUMENT_LINK_RESOLVER } from 'src/ri-intelligence/application/ri-document-link-resolver.port';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RI_DOCUMENT_QUERY } from 'src/ri-intelligence/application/ri-document-query.port';
import { HttpRiDocumentLinkResolverAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-link-resolver.adapter';
import { RI_SUMMARY_CACHE } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { InMemoryRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-document-discovery.adapter';
import { InMemoryRiSummaryCacheAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-summary-cache.adapter';
import { StocksRiAssetAutocompleteAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-asset-autocomplete.adapter';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';
import { HttpRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-discovery.adapter';
import { ResilientRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/resilient-ri-document-discovery.adapter';
import { CatalogRiDocumentQueryAdapter } from 'src/ri-intelligence/infrastructure/catalog-ri-document-query.adapter';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import { FiiRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/fii-ri-document-discovery.adapter';
import { PuppeteerRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/puppeteer-ri-document-discovery.adapter';

@Module({
	imports: [StockModule],
	controllers: [RiIntelligenceController],
	providers: [
		RiDocumentCatalogService,
		RiDocumentSummaryService,
		StocksRiAssetAutocompleteAdapter,
		InMemoryRiDocumentDiscoveryAdapter,
		HttpRiDocumentDiscoveryAdapter,
		HttpRiDocumentLinkResolverAdapter,
		CatalogRiDocumentQueryAdapter,
		{
			provide: RI_SUMMARY_CACHE,
			useClass: InMemoryRiSummaryCacheAdapter,
		},
		{
			provide: RI_ASSET_AUTOCOMPLETE,
			useExisting: StocksRiAssetAutocompleteAdapter,
		},
		CvmRiDocumentDiscoveryAdapter,
		FiiRiDocumentDiscoveryAdapter,
		PuppeteerRiDocumentDiscoveryAdapter,
		{
			provide: RI_DOCUMENT_DISCOVERY,
			useFactory: (
				cvmAdapter: CvmRiDocumentDiscoveryAdapter,
				fiiAdapter: FiiRiDocumentDiscoveryAdapter,
				puppeteerAdapter: PuppeteerRiDocumentDiscoveryAdapter
			) =>
				new ResilientRiDocumentDiscoveryAdapter(
					cvmAdapter,
					fiiAdapter,
					puppeteerAdapter
				),
			inject: [
				CvmRiDocumentDiscoveryAdapter,
				FiiRiDocumentDiscoveryAdapter,
				PuppeteerRiDocumentDiscoveryAdapter,
			],
		},
		{
			provide: RI_DOCUMENT_LINK_RESOLVER,
			useExisting: HttpRiDocumentLinkResolverAdapter,
		},
		{
			provide: RI_DOCUMENT_QUERY,
			useExisting: CatalogRiDocumentQueryAdapter,
		},
	],
	exports: [
		RiDocumentCatalogService,
		RiDocumentSummaryService,
		RI_SUMMARY_CACHE,
		RI_DOCUMENT_QUERY,
	],
})
export class RiIntelligenceModule {}
