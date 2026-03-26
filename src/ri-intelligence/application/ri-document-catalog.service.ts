import { Inject, Injectable } from '@nestjs/common';
import {
	RI_ASSET_AUTOCOMPLETE,
	RiAssetAutocompletePort,
	RiAssetSuggestion,
} from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import {
	RI_DOCUMENT_DISCOVERY,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import {
	RI_DOCUMENT_LINK_RESOLVER,
	RiDocumentLinkResolverPort,
} from 'src/ri-intelligence/application/ri-document-link-resolver.port';
import { RiDocumentRecord, RiDocumentType } from 'src/ri-intelligence/domain/ri-document.types';

export interface SearchRiDocumentsInput {
	query?: string;
	documentType?: RiDocumentType;
	limit?: number;
}

export interface SearchRiDocumentsOutput {
	documents: RiDocumentRecord[];
	total: number;
	warnings: string[];
	matches: RiAssetSuggestion[];
}

@Injectable()
export class RiDocumentCatalogService {
	private readonly maxTickerMatches = 8;
	private readonly maxDocumentsPerTicker = 20;
	private readonly recentWindowDays = 540;
	private readonly prioritizedTypes: ReadonlySet<RiDocumentType> = new Set([
		'earnings_release',
		'investor_presentation',
		'material_fact',
	]);
	private readonly featuredAssets: RiAssetSuggestion[] = [
		{ ticker: 'BBDC4', company: 'Banco Bradesco S.A.' },
		{ ticker: 'ITUB4', company: 'Itaú Unibanco Holding S.A.' },
		{ ticker: 'BBAS3', company: 'Banco do Brasil S.A.' },
		{ ticker: 'PETR4', company: 'Petróleo Brasileiro S.A. - Petrobras' },
		{ ticker: 'VALE3', company: 'Vale S.A.' },
	];

	constructor(
		@Inject(RI_ASSET_AUTOCOMPLETE)
		private readonly assetAutocomplete: RiAssetAutocompletePort,
		@Inject(RI_DOCUMENT_DISCOVERY)
		private readonly documentDiscovery: RiDocumentDiscoveryPort,
		@Inject(RI_DOCUMENT_LINK_RESOLVER)
		private readonly documentLinkResolver: RiDocumentLinkResolverPort
	) {}

	async autocomplete(query: string, limit = 8): Promise<RiAssetSuggestion[]> {
		const safeLimit = this.normalizeLimit(limit, 1, this.maxTickerMatches);
		return this.assetAutocomplete.search(query, safeLimit);
	}

	async search(input: SearchRiDocumentsInput): Promise<SearchRiDocumentsOutput> {
		const query = String(input.query || '').trim();
		const limit = this.normalizeLimit(input.limit || 50, 1, 200);
		const documentType = input.documentType;
		const warnings: string[] = [];

		const matches = await this.resolveMatches(query);
		if (!matches.length) {
			return {
				documents: [],
				total: 0,
				warnings: query ? ['ri_no_matching_assets'] : ['ri_query_empty'],
				matches: [],
			};
		}

		const gathered = await Promise.all(
			matches.map(async (match) => {
				const origin = this.resolveOrigin(match);
				const documents = await this.documentDiscovery.discover({
					ticker: match.ticker,
					company: match.company,
					origin,
				});
				return documents.slice(0, this.maxDocumentsPerTicker);
			})
		);

		const merged = gathered.flat();
		if (!merged.length) warnings.push('ri_no_documents_found');

		const scoped = merged.filter((document) =>
			this.matchesRecentRelevantScope(document, documentType)
		);
		if (merged.length && !scoped.length) warnings.push('ri_no_recent_releases_found');

		const validated = (
			await Promise.all(
				scoped.map((document) => this.resolveAndValidateDocument(document))
			)
		).filter((document): document is RiDocumentRecord => Boolean(document));

		if (scoped.length && !validated.length) warnings.push('ri_no_valid_documents_found');
		if (validated.length < scoped.length) warnings.push('ri_invalid_documents_filtered');

		const filtered = (documentType
			? validated.filter((document) => document.documentType === documentType)
			: validated
		)
			.sort(
				(a, b) =>
					new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
			)
			.slice(0, limit);

		if (documentType && !filtered.length) {
			warnings.push('ri_no_documents_for_selected_type');
		}

		return {
			documents: filtered,
			total: filtered.length,
			warnings,
			matches,
		};
	}

	async getDocumentPdf(documentId: string, query: string): Promise<{ url: string } | null> {
		const result = await this.search({ query, limit: 200 });
		const document = result.documents.find((item) => item.id === documentId);
		if (!document?.source?.value) return null;
		return { url: document.source.value };
	}

	private async resolveMatches(query: string): Promise<RiAssetSuggestion[]> {
		if (!query) return this.featuredAssets.slice(0, this.maxTickerMatches);
		return this.assetAutocomplete.search(query, this.maxTickerMatches);
	}

	private resolveOrigin(match: RiAssetSuggestion): string {
		const knownOrigins: Record<string, string> = {
			BBDC4: 'https://ri.bradesco.com.br',
			ITUB4: 'https://www.itau.com.br/relacoes-com-investidores',
			BBAS3: 'https://ri.bb.com.br',
			PETR4: 'https://petrobras.com.br/ri',
			VALE3: 'https://vale.com/ri',
		};
		const known = knownOrigins[match.ticker];
		if (known) return known;

		const companySlug = String(match.company || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')
			.slice(0, 40);
		return companySlug ? `https://ri.${companySlug}.com.br` : 'https://ri.empresa.com.br';
	}

	private normalizeLimit(value: number, min: number, max: number): number {
		if (!Number.isFinite(value)) return min;
		return Math.max(min, Math.min(max, Math.trunc(value)));
	}

	private async resolveAndValidateDocument(
		document: RiDocumentRecord
	): Promise<RiDocumentRecord | null> {
		if (document.source?.type !== 'url') return document;

		const resolved = await this.documentLinkResolver.resolve({
			url: document.source.value,
			origin: this.resolveOrigin({ ticker: document.ticker, company: document.company }),
		});
		if (!resolved.isValid || !resolved.resolvedUrl) return null;

		return {
			...document,
			source: {
				...document.source,
				value: resolved.resolvedUrl,
			},
		};
	}

	private matchesRecentRelevantScope(
		document: RiDocumentRecord,
		documentType?: RiDocumentType
	): boolean {
		if (!this.isRecentDocument(document.publishedAt)) return false;
		if (documentType) return document.documentType === documentType;
		return this.prioritizedTypes.has(document.documentType);
	}

	private isRecentDocument(publishedAt: string): boolean {
		const publishedTime = new Date(publishedAt).getTime();
		if (!Number.isFinite(publishedTime)) return false;
		const ageMs = Date.now() - publishedTime;
		const maxAgeMs = this.recentWindowDays * 24 * 60 * 60 * 1000;
		return ageMs <= maxAgeMs;
	}
}
