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
import {
	RiDocumentRecord,
	RiDocumentType,
} from 'src/ri-intelligence/domain/ri-document.types';
import { CANONICAL_RI_DOCUMENT_TYPES } from 'src/ri-intelligence/domain/ri-document-classifier';

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
	fallback: {
		availableDocumentTypes: RiDocumentType[];
		suggestedFilters: Array<RiDocumentType | 'all'>;
	};
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
		'financial_statement',
		'management_report',
		'conference_call_material',
		'dividend_notice',
		'reference_form',
		'shareholder_notice',
		'other_ri_document',
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

	async search(
		input: SearchRiDocumentsInput
	): Promise<SearchRiDocumentsOutput> {
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
				fallback: {
					availableDocumentTypes: [],
					suggestedFilters: ['all'],
				},
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

		const recent = merged.filter((document) =>
			this.matchesRecentRelevantScope(document)
		);
		if (merged.length && !recent.length)
			warnings.push('ri_no_recent_releases_found');

		const validated = (
			await Promise.all(
				recent.map((document) => this.resolveAndValidateDocument(document))
			)
		).filter((document): document is RiDocumentRecord => Boolean(document));

		if (recent.length && !validated.length)
			warnings.push('ri_no_valid_documents_found');
		if (validated.length < recent.length)
			warnings.push('ri_invalid_documents_filtered');

		const filteredByType = documentType
			? validated.filter((document) => document.documentType === documentType)
			: validated.filter((document) =>
					this.prioritizedTypes.has(document.documentType)
				);

		const filtered = filteredByType
			.sort(
				(a, b) =>
					new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
			)
			.slice(0, limit);

		const availableDocumentTypes =
			this.collectAvailableDocumentTypes(validated);
		const suggestedFilters = this.resolveSuggestedFilters(
			documentType,
			availableDocumentTypes
		);

		if (documentType && !filtered.length && availableDocumentTypes.length > 0) {
			warnings.push('ri_no_documents_for_selected_type');
		}

		return {
			documents: filtered,
			total: filtered.length,
			warnings,
			matches,
			fallback: {
				availableDocumentTypes,
				suggestedFilters,
			},
		};
	}

	async getDocumentPdf(
		documentId: string,
		query: string
	): Promise<{ url: string } | null> {
		const result = await this.search({ query, limit: 200 });
		const document = result.documents.find((item) => item.id === documentId);
		if (!document?.source?.value) return null;
		return { url: document.source.value };
	}

	private async resolveMatches(query: string): Promise<RiAssetSuggestion[]> {
		if (!query) return this.featuredAssets.slice(0, this.maxTickerMatches);
		const matches = await this.assetAutocomplete.search(
			query,
			this.maxTickerMatches
		);
		if (!matches.length) return [];

		const normalizedQuery = String(query || '')
			.trim()
			.toUpperCase();
		if (!normalizedQuery) return matches;

		const exactTickerMatch = matches.find(
			(match) => String(match.ticker || '').toUpperCase() === normalizedQuery
		);
		if (exactTickerMatch) return [exactTickerMatch];

		return matches;
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
		return companySlug
			? `https://ri.${companySlug}.com.br`
			: 'https://ri.empresa.com.br';
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
			origin: this.resolveOrigin({
				ticker: document.ticker,
				company: document.company,
			}),
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

	private matchesRecentRelevantScope(document: RiDocumentRecord): boolean {
		if (!this.isRecentDocument(document.publishedAt)) return false;
		return true;
	}

	private collectAvailableDocumentTypes(
		documents: RiDocumentRecord[]
	): RiDocumentType[] {
		const available = new Set(
			documents.map((document) => document.documentType)
		);
		return CANONICAL_RI_DOCUMENT_TYPES.filter((type) => available.has(type));
	}

	private resolveSuggestedFilters(
		selectedType: RiDocumentType | undefined,
		availableDocumentTypes: RiDocumentType[]
	): Array<RiDocumentType | 'all'> {
		const suggestions: Array<RiDocumentType | 'all'> = ['all'];
		if (
			availableDocumentTypes.includes('earnings_release') &&
			selectedType !== 'earnings_release'
		) {
			suggestions.push('earnings_release');
		}
		for (const type of availableDocumentTypes) {
			if (type !== selectedType && type !== 'earnings_release') {
				suggestions.push(type);
				break;
			}
		}
		return suggestions;
	}

	private isRecentDocument(publishedAt: string): boolean {
		const publishedTime = new Date(publishedAt).getTime();
		if (!Number.isFinite(publishedTime)) return false;
		const ageMs = Date.now() - publishedTime;
		const maxAgeMs = this.recentWindowDays * 24 * 60 * 60 * 1000;
		return ageMs <= maxAgeMs;
	}
}
