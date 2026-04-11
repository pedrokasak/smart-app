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
import {
	inferQuarterFromDocument,
	previousQuarter,
	resolveExpectedReportingQuarter,
	sameQuarter,
	toQuarterLabel,
} from 'src/ri-intelligence/domain/ri-quarter-resolution';

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

export interface RetrieveRelevantRiDocumentInput {
	ticker: string;
	documentType?: RiDocumentType;
	asOfDate?: Date | string;
}

export interface RetrieveRelevantRiDocumentOutput {
	status: 'found' | 'unavailable';
	ticker: string;
	company: string | null;
	requestedDocumentType: RiDocumentType | null;
	document: RiDocumentRecord | null;
	warnings: string[];
	reason:
		| 'document_found'
		| 'invalid_ticker'
		| 'ticker_not_resolved'
		| 'source_not_resolved'
		| 'no_documents_discovered'
		| 'no_valid_documents_found'
		| 'no_safe_document_for_policy';
	selection: {
		policy:
			| 'latest_or_current_quarter_release'
			| 'requested_type_when_no_release'
			| 'most_recent_safe_document';
		applied:
			| 'current_quarter_release'
			| 'previous_quarter_release_fallback'
			| 'latest_release'
			| 'requested_type'
			| 'most_recent_prioritized'
			| 'none';
		fallbackApplied: boolean;
		fallbackReason: string | null;
		expectedQuarter: string | null;
		selectedQuarter: string | null;
	};
	source: {
		officialRiUrl: string | null;
		trustLevel: 'official_registry' | 'unavailable';
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
	private readonly officialRiByTicker: Record<string, string> = {
		BBDC4: 'https://ri.bradesco.com.br',
		ITUB4: 'https://www.itau.com.br/relacoes-com-investidores',
		BBAS3: 'https://ri.bb.com.br',
		PETR4: 'https://petrobras.com.br/ri',
		VALE3: 'https://vale.com/ri',
	};

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

	async retrieveMostRelevantDocument(
		input: RetrieveRelevantRiDocumentInput
	): Promise<RetrieveRelevantRiDocumentOutput> {
		const ticker = this.normalizeTicker(input.ticker);
		const requestedDocumentType = input.documentType || null;
		if (!ticker) {
			return this.unavailableResult({
				ticker,
				company: null,
				requestedDocumentType,
				reason: 'invalid_ticker',
				warnings: ['ri_invalid_ticker'],
				officialRiUrl: null,
			});
		}

		const match = await this.resolveTickerCompany(ticker);
		if (!match) {
			return this.unavailableResult({
				ticker,
				company: null,
				requestedDocumentType,
				reason: 'ticker_not_resolved',
				warnings: ['ri_ticker_not_resolved'],
				officialRiUrl: null,
			});
		}

		const officialRiUrl = this.officialRiByTicker[ticker] || null;
		if (!officialRiUrl) {
			return this.unavailableResult({
				ticker,
				company: match.company,
				requestedDocumentType,
				reason: 'source_not_resolved',
				warnings: ['ri_official_source_not_found'],
				officialRiUrl: null,
			});
		}

		const discovered = await this.safeDiscover({
			ticker: match.ticker,
			company: match.company,
			origin: officialRiUrl,
		});
		if (!discovered.length) {
			return this.unavailableResult({
				ticker,
				company: match.company,
				requestedDocumentType,
				reason: 'no_documents_discovered',
				warnings: ['ri_no_documents_found'],
				officialRiUrl,
			});
		}

		const validated = (
			await Promise.all(
				discovered.map((document) => this.resolveAndValidateDocument(document))
			)
		).filter((document): document is RiDocumentRecord => Boolean(document));
		if (!validated.length) {
			return this.unavailableResult({
				ticker,
				company: match.company,
				requestedDocumentType,
				reason: 'no_valid_documents_found',
				warnings: ['ri_no_valid_documents_found'],
				officialRiUrl,
			});
		}

		const selection = this.selectMostRelevantDocument(validated, {
			requestedDocumentType,
			asOfDate: input.asOfDate,
		});
		if (!selection.document) {
			return this.unavailableResult({
				ticker,
				company: match.company,
				requestedDocumentType,
				reason: 'no_safe_document_for_policy',
				warnings: selection.warnings,
				officialRiUrl,
				selection: selection.selection,
			});
		}

		return {
			status: 'found',
			ticker: match.ticker,
			company: match.company,
			requestedDocumentType,
			document: selection.document,
			warnings: selection.warnings,
			reason: 'document_found',
			selection: selection.selection,
			source: {
				officialRiUrl,
				trustLevel: 'official_registry',
			},
		};
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

	private normalizeTicker(rawTicker: string): string {
		return String(rawTicker || '')
			.trim()
			.toUpperCase()
			.replace(/\.SA$/i, '');
	}

	private async resolveTickerCompany(
		ticker: string
	): Promise<RiAssetSuggestion | null> {
		const featuredMatch = this.featuredAssets.find(
			(item) => this.normalizeTicker(item.ticker) === ticker
		);
		if (featuredMatch) {
			return {
				ticker,
				company: featuredMatch.company,
			};
		}

		try {
			const matches = await this.assetAutocomplete.search(
				ticker,
				this.maxTickerMatches
			);
			const exact = matches.filter(
				(item) => this.normalizeTicker(item.ticker) === ticker
			);
			if (exact.length !== 1) return null;
			return {
				ticker,
				company: exact[0].company,
			};
		} catch {
			return null;
		}
	}

	private async safeDiscover(
		input: Parameters<RiDocumentDiscoveryPort['discover']>[0]
	): Promise<RiDocumentRecord[]> {
		try {
			const output = await this.documentDiscovery.discover(input);
			return Array.isArray(output) ? output : [];
		} catch {
			return [];
		}
	}

	private resolveOrigin(match: RiAssetSuggestion): string {
		const knownOrigins: Record<string, string> = {
			BBDC4: 'https://ri.bradesco.com.br',
			ITUB4: 'https://www.itau.com.br/relacoes-com-investidores',
			BBAS3: 'https://ri.bb.com.br',
			PETR4: 'https://petrobras.com.br/ri',
			VALE3: 'https://vale.com/ri',
		};
		const ticker = match.ticker.toUpperCase();
		const known = knownOrigins[ticker];
		if (known) return known;

		if (ticker.endsWith('11')) {
			return `https://statusinvest.com.br/fii/${ticker.toLowerCase()}`;
		}

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

	private selectMostRelevantDocument(
		documents: RiDocumentRecord[],
		params: {
			requestedDocumentType: RiDocumentType | null;
			asOfDate?: Date | string;
		}
	): {
		document: RiDocumentRecord | null;
		warnings: string[];
		selection: RetrieveRelevantRiDocumentOutput['selection'];
	} {
		const warnings: string[] = [];
		const releases = documents.filter(
			(document) => document.documentType === 'earnings_release'
		);
		const expectedQuarter = resolveExpectedReportingQuarter(
			this.toSafeDate(params.asOfDate)
		);
		const previousExpectedQuarter = previousQuarter(expectedQuarter);
		const defaultSelection: RetrieveRelevantRiDocumentOutput['selection'] = {
			policy: 'most_recent_safe_document',
			applied: 'none',
			fallbackApplied: false,
			fallbackReason: null,
			expectedQuarter: toQuarterLabel(expectedQuarter),
			selectedQuarter: null,
		};

		if (releases.length > 0) {
			const releasesByDate = this.sortByPublishedAtDesc(releases);
			const currentQuarter = releasesByDate.find((document) =>
				sameQuarter(inferQuarterFromDocument(document), expectedQuarter)
			);
			if (currentQuarter) {
				return {
					document: currentQuarter,
					warnings,
					selection: {
						...defaultSelection,
						policy: 'latest_or_current_quarter_release',
						applied: 'current_quarter_release',
						selectedQuarter: toQuarterLabel(
							inferQuarterFromDocument(currentQuarter)
						),
					},
				};
			}

			const previousQuarterRelease = releasesByDate.find((document) =>
				sameQuarter(
					inferQuarterFromDocument(document),
					previousExpectedQuarter
				)
			);
			if (previousQuarterRelease) {
				warnings.push('ri_current_quarter_release_unavailable');
				return {
					document: previousQuarterRelease,
					warnings,
					selection: {
						...defaultSelection,
						policy: 'latest_or_current_quarter_release',
						applied: 'previous_quarter_release_fallback',
						fallbackApplied: true,
						fallbackReason: 'ri_previous_quarter_release_fallback',
						selectedQuarter: toQuarterLabel(
							inferQuarterFromDocument(previousQuarterRelease)
						),
					},
				};
			}

			return {
				document: releasesByDate[0] || null,
				warnings,
				selection: {
					...defaultSelection,
					policy: 'latest_or_current_quarter_release',
					applied: 'latest_release',
					selectedQuarter: toQuarterLabel(
						releasesByDate[0] ? inferQuarterFromDocument(releasesByDate[0]) : null
					),
				},
			};
		}

		if (params.requestedDocumentType) {
			const requestedTypeDocs = this.sortByPublishedAtDesc(
				documents.filter(
					(document) => document.documentType === params.requestedDocumentType
				)
			);
			if (!requestedTypeDocs.length) {
				warnings.push('ri_no_documents_for_selected_type');
				return {
					document: null,
					warnings,
					selection: {
						...defaultSelection,
						policy: 'requested_type_when_no_release',
					},
				};
			}

			return {
				document: requestedTypeDocs[0],
				warnings,
				selection: {
					...defaultSelection,
					policy: 'requested_type_when_no_release',
					applied: 'requested_type',
				},
			};
		}

		const prioritized = this.sortByPublishedAtDesc(
			documents.filter((document) =>
				this.prioritizedTypes.has(document.documentType)
			)
		);
		return {
			document: prioritized[0] || null,
			warnings: prioritized.length ? warnings : ['ri_no_safe_document_for_policy'],
			selection: {
				...defaultSelection,
				applied: prioritized.length ? 'most_recent_prioritized' : 'none',
			},
		};
	}

	private toSafeDate(value?: Date | string): Date {
		if (!value) return new Date();
		const parsed = value instanceof Date ? value : new Date(value);
		return Number.isFinite(parsed.getTime()) ? parsed : new Date();
	}

	private sortByPublishedAtDesc(
		documents: RiDocumentRecord[]
	): RiDocumentRecord[] {
		return [...documents].sort(
			(a, b) =>
				new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
		);
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

	private unavailableResult(params: {
		ticker: string;
		company: string | null;
		requestedDocumentType: RiDocumentType | null;
		reason: RetrieveRelevantRiDocumentOutput['reason'];
		warnings: string[];
		officialRiUrl: string | null;
		selection?: RetrieveRelevantRiDocumentOutput['selection'];
	}): RetrieveRelevantRiDocumentOutput {
		return {
			status: 'unavailable',
			ticker: params.ticker,
			company: params.company,
			requestedDocumentType: params.requestedDocumentType,
			document: null,
			warnings: params.warnings,
			reason: params.reason,
			selection: params.selection || {
				policy: 'most_recent_safe_document',
				applied: 'none',
				fallbackApplied: false,
				fallbackReason: null,
				expectedQuarter: null,
				selectedQuarter: null,
			},
			source: {
				officialRiUrl: params.officialRiUrl,
				trustLevel: params.officialRiUrl ? 'official_registry' : 'unavailable',
			},
		};
	}
}
