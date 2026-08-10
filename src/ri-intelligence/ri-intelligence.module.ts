import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StockModule } from 'src/stocks/stocks.module';
import { RI_ASSET_AUTOCOMPLETE } from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RI_DOCUMENT_DISCOVERY } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RI_DOCUMENT_LINK_RESOLVER } from 'src/ri-intelligence/application/ri-document-link-resolver.port';
import { RI_ORIGIN_SEARCH } from 'src/ri-intelligence/application/ri-origin-search.port';
import { GoogleCseRiOriginSearchAdapter } from 'src/ri-intelligence/infrastructure/google-cse-ri-origin-search.adapter';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RI_DOCUMENT_QUERY } from 'src/ri-intelligence/application/ri-document-query.port';
import { RI_ISSUER_CATALOG } from 'src/ri-intelligence/application/ri-issuer-catalog.port';
import { HttpRiDocumentLinkResolverAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-link-resolver.adapter';
import { RI_SUMMARY_CACHE } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { InMemoryRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-document-discovery.adapter';
import { InMemoryRiSummaryCacheAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-summary-cache.adapter';
import { StocksRiAssetAutocompleteAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-asset-autocomplete.adapter';
import { StocksRiIssuerCatalogAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-issuer-catalog.adapter';
import { B3RegistryCnpjResolverAdapter } from 'src/ri-intelligence/infrastructure/b3-registry-cnpj-resolver.adapter';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';
import { HttpRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-discovery.adapter';
import { ResilientRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/resilient-ri-document-discovery.adapter';
import { CatalogRiDocumentQueryAdapter } from 'src/ri-intelligence/infrastructure/catalog-ri-document-query.adapter';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import { FiiRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/fii-ri-document-discovery.adapter';
import { PuppeteerRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/puppeteer-ri-document-discovery.adapter';
import { PuppeteerBrowserPool } from 'src/ri-intelligence/infrastructure/puppeteer-browser-pool.service';

@Module({
	imports: [StockModule, HttpModule],
	controllers: [RiIntelligenceController],
	providers: [
		RiDocumentCatalogService,
		RiDocumentSummaryService,
		StocksRiAssetAutocompleteAdapter,
		B3RegistryCnpjResolverAdapter,
		StocksRiIssuerCatalogAdapter,
		InMemoryRiDocumentDiscoveryAdapter,
		HttpRiDocumentDiscoveryAdapter,
		HttpRiDocumentLinkResolverAdapter,
		CatalogRiDocumentQueryAdapter,
		GoogleCseRiOriginSearchAdapter,
		{
			provide: RI_ORIGIN_SEARCH,
			useExisting: GoogleCseRiOriginSearchAdapter,
		},
		{
			provide: RI_SUMMARY_CACHE,
			useClass: InMemoryRiSummaryCacheAdapter,
		},
		{
			provide: RI_ASSET_AUTOCOMPLETE,
			useExisting: StocksRiAssetAutocompleteAdapter,
		},
		{
			provide: RI_ISSUER_CATALOG,
			useExisting: StocksRiIssuerCatalogAdapter,
		},
		CvmRiDocumentDiscoveryAdapter,
		FiiRiDocumentDiscoveryAdapter,
		PuppeteerBrowserPool,
		PuppeteerRiDocumentDiscoveryAdapter,
		{
			provide: RI_DOCUMENT_DISCOVERY,
			useFactory: (
				httpAdapter: HttpRiDocumentDiscoveryAdapter,
				cvmAdapter: CvmRiDocumentDiscoveryAdapter,
				fiiAdapter: FiiRiDocumentDiscoveryAdapter,
				puppeteerAdapter: PuppeteerRiDocumentDiscoveryAdapter
			) =>
				new ResilientRiDocumentDiscoveryAdapter(
					httpAdapter,
					cvmAdapter,
					fiiAdapter,
					puppeteerAdapter
				),
			inject: [
				HttpRiDocumentDiscoveryAdapter,
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
