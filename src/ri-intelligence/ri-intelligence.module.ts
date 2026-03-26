import { Module } from '@nestjs/common';
import { StockModule } from 'src/stocks/stocks.module';
import {
	RI_ASSET_AUTOCOMPLETE,
} from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RI_DOCUMENT_DISCOVERY } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RI_DOCUMENT_LINK_RESOLVER } from 'src/ri-intelligence/application/ri-document-link-resolver.port';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { HttpRiDocumentLinkResolverAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-link-resolver.adapter';
import { RI_SUMMARY_CACHE } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { InMemoryRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-document-discovery.adapter';
import { InMemoryRiSummaryCacheAdapter } from 'src/ri-intelligence/infrastructure/in-memory-ri-summary-cache.adapter';
import { StocksRiAssetAutocompleteAdapter } from 'src/ri-intelligence/infrastructure/stocks-ri-asset-autocomplete.adapter';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';

@Module({
	imports: [StockModule],
	controllers: [RiIntelligenceController],
	providers: [
		RiDocumentCatalogService,
		RiDocumentSummaryService,
		StocksRiAssetAutocompleteAdapter,
		InMemoryRiDocumentDiscoveryAdapter,
		HttpRiDocumentLinkResolverAdapter,
		{
			provide: RI_SUMMARY_CACHE,
			useClass: InMemoryRiSummaryCacheAdapter,
		},
		{
			provide: RI_ASSET_AUTOCOMPLETE,
			useExisting: StocksRiAssetAutocompleteAdapter,
		},
		{
			provide: RI_DOCUMENT_DISCOVERY,
			useExisting: InMemoryRiDocumentDiscoveryAdapter,
		},
		{
			provide: RI_DOCUMENT_LINK_RESOLVER,
			useExisting: HttpRiDocumentLinkResolverAdapter,
		},
	],
	exports: [RiDocumentCatalogService, RiDocumentSummaryService, RI_SUMMARY_CACHE],
})
export class RiIntelligenceModule {}
