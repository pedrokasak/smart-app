import { RiAssetAutocompletePort } from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import {
	RiDocumentCatalogService,
	SearchRiDocumentsOutput,
} from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import {
	RiDocumentLinkResolverPort,
	ResolveRiDocumentLinkResult,
} from 'src/ri-intelligence/application/ri-document-link-resolver.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

describe('RiDocumentCatalogService', () => {
	const baseDocument = (
		overrides: Partial<RiDocumentRecord> = {}
	): RiDocumentRecord => ({
		id: 'BBDC4:earnings_release:2026-02-06T00:00:00.000Z:0',
		ticker: 'BBDC4',
		company: 'Banco Bradesco S.A.',
		title: 'Release de Resultados 4T25',
		documentType: 'earnings_release',
		period: '4T25',
		publishedAt: '2026-02-06T00:00:00.000Z',
		source: {
			type: 'url',
			value: 'https://ri.example.com/bbdc4/4t25.pdf',
		},
		classification: {
			method: 'deterministic_rules',
			confidence: 'high',
		},
		contentStatus: 'metadata_only',
		...overrides,
	});

	const validResolution = (
		resolvedUrl = 'https://ri.example.com/bbdc4/4t25.pdf'
	): ResolveRiDocumentLinkResult => ({
		isValid: true,
		resolvedUrl,
		statusCode: 200,
		contentType: 'application/pdf',
	});

	function makeService(params?: {
		documents?: RiDocumentRecord[];
		matches?: Array<{ ticker: string; company: string }>;
		resolve?: jest.Mock;
	}) {
		const autocomplete: RiAssetAutocompletePort = {
			search: jest
				.fn()
				.mockResolvedValue(
					params?.matches || [
						{ ticker: 'BBDC4', company: 'Banco Bradesco S.A.' },
					]
				),
		};
		const discovery: RiDocumentDiscoveryPort = {
			discover: jest
				.fn()
				.mockResolvedValue(params?.documents || [baseDocument()]),
		};
		const resolver: RiDocumentLinkResolverPort = {
			resolve:
				params?.resolve || jest.fn().mockResolvedValue(validResolution()),
		};

		const service = new RiDocumentCatalogService(
			autocomplete,
			discovery,
			resolver
		);
		return { service, autocomplete, discovery, resolver };
	}

	it('1) returns a valid resolved document when link validation succeeds', async () => {
		const { service } = makeService({
			resolve: jest
				.fn()
				.mockResolvedValue(
					validResolution('https://cdn.ri.example.com/final.pdf')
				),
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toHaveLength(1);
		expect(output.documents[0].source.value).toBe(
			'https://cdn.ri.example.com/final.pdf'
		);
		expect(output.warnings).not.toContain('ri_no_valid_documents_found');
	});

	it('2) resolves relative links correctly through resolver pipeline', async () => {
		const { service, resolver } = makeService({
			documents: [
				baseDocument({
					source: { type: 'url', value: '/docs/resultado-4t25.pdf' },
				}),
			],
			resolve: jest
				.fn()
				.mockResolvedValue(
					validResolution('https://ri.bradesco.com.br/docs/resultado-4t25.pdf')
				),
		});

		const output = await service.search({ query: 'BBDC4' });

		expect((resolver.resolve as jest.Mock).mock.calls[0][0]).toMatchObject({
			url: '/docs/resultado-4t25.pdf',
			origin: 'https://ri.bradesco.com.br',
		});
		expect(output.documents[0].source.value).toBe(
			'https://ri.bradesco.com.br/docs/resultado-4t25.pdf'
		);
	});

	it('resolves known RI origins for BBDC4 and PETR4 before link validation', async () => {
		const resolve = jest
			.fn()
			.mockResolvedValue(
				validResolution('https://ri.example.com/doc-valid.pdf')
			);

		const { service, resolver } = makeService({
			matches: [
				{ ticker: 'BBDC4', company: 'Banco Bradesco S.A.' },
				{ ticker: 'PETR4', company: 'Petróleo Brasileiro S.A. - Petrobras' },
			],
			documents: [
				baseDocument({
					ticker: 'BBDC4',
					company: 'Banco Bradesco S.A.',
					source: { type: 'url', value: '/docs/resultado-4t25.pdf' },
				}),
				baseDocument({
					id: 'PETR4:earnings_release:2026-02-26T00:00:00.000Z:0',
					ticker: 'PETR4',
					company: 'Petróleo Brasileiro S.A. - Petrobras',
					source: { type: 'url', value: '/ri/release-resultados-4t25.pdf' },
				}),
			],
			resolve,
		});

		await service.search({ query: 'PETR4' });

		const calls = (resolver.resolve as jest.Mock).mock.calls.map(
			(call) => call[0]
		);
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ origin: 'https://ri.bradesco.com.br' }),
				expect.objectContaining({ origin: 'https://petrobras.com.br/ri' }),
			])
		);
	});

	it('3) accepts redirected link when final URL is valid', async () => {
		const { service } = makeService({
			resolve: jest
				.fn()
				.mockResolvedValue(
					validResolution('https://downloads.ri.com/release-4t25.pdf')
				),
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toHaveLength(1);
		expect(output.documents[0].source.value).toBe(
			'https://downloads.ri.com/release-4t25.pdf'
		);
	});

	it('4) rejects invalid links and does not return them', async () => {
		const { service } = makeService({
			resolve: jest.fn().mockResolvedValue({
				isValid: false,
				resolvedUrl: null,
				statusCode: 500,
				contentType: 'text/html',
				rejectionReason: 'invalid_http_status',
			}),
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toEqual([]);
		expect(output.warnings).toContain('ri_no_valid_documents_found');
	});

	it('5) rejects links containing /error/404', async () => {
		const { service } = makeService({
			resolve: jest.fn().mockResolvedValue({
				isValid: false,
				resolvedUrl: 'https://api.mziq.com/mzfilemanager/error/404',
				statusCode: 200,
				contentType: 'text/html',
				rejectionReason: 'known_error_route',
			}),
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toEqual([]);
		expect(output.warnings).toContain('ri_no_valid_documents_found');
	});

	it('6) keeps only valid documents when multiple links are found', async () => {
		const resolve = jest
			.fn()
			.mockResolvedValueOnce(
				validResolution('https://ri.example.com/doc-valido.pdf')
			)
			.mockResolvedValueOnce({
				isValid: false,
				resolvedUrl: null,
				statusCode: 404,
				contentType: 'text/html',
				rejectionReason: 'invalid_http_status',
			});
		const { service } = makeService({
			documents: [
				baseDocument({ id: 'valid-doc' }),
				baseDocument({
					id: 'invalid-doc',
					source: { type: 'url', value: 'https://ri.bad/doc' },
				}),
			],
			resolve,
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toHaveLength(1);
		expect(output.documents[0].id).toBe('valid-doc');
		expect(output.warnings).toContain('ri_invalid_documents_filtered');
	});

	it('7) returns safe empty response when no valid documents are available', async () => {
		const { service } = makeService({
			documents: [baseDocument({ id: 'doc-1' }), baseDocument({ id: 'doc-2' })],
			resolve: jest.fn().mockResolvedValue({
				isValid: false,
				resolvedUrl: null,
				statusCode: 404,
				contentType: 'text/html',
				rejectionReason: 'invalid_http_status',
			}),
		});

		const output: SearchRiDocumentsOutput = await service.search({
			query: 'BBDC4',
		});

		expect(output.documents).toEqual([]);
		expect(output.total).toBe(0);
		expect(output.warnings).toContain('ri_no_valid_documents_found');
	});

	it('keeps focus on recent releases and ignores old documents', async () => {
		const { service } = makeService({
			documents: [
				baseDocument({
					id: 'doc-old',
					publishedAt: '2020-01-01T00:00:00.000Z',
				}),
			],
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toEqual([]);
		expect(output.warnings).toContain('ri_no_recent_releases_found');
	});

	it('returns no documents warning when discovery has no results', async () => {
		const { service } = makeService({ documents: [] });

		const output = await service.search({ query: 'BBDC4' });

		expect(output.documents).toEqual([]);
		expect(output.total).toBe(0);
		expect(output.warnings).toContain('ri_no_documents_found');
		expect(output.fallback.availableDocumentTypes).toEqual([]);
	});

	it('returns clear warning and fallback filters when selected type has no compatible document', async () => {
		const { service } = makeService({
			documents: [
				baseDocument({
					documentType: 'earnings_release',
					title: 'Release de Resultados 4T25',
				}),
			],
		});

		const output = await service.search({
			query: 'BBDC4',
			documentType: 'investor_presentation',
		});

		expect(output.documents).toEqual([]);
		expect(output.warnings).toContain('ri_no_documents_for_selected_type');
		expect(output.warnings).not.toContain('ri_no_documents_found');
		expect(output.fallback.availableDocumentTypes).toEqual([
			'earnings_release',
		]);
		expect(output.fallback.suggestedFilters).toEqual([
			'all',
			'earnings_release',
		]);
	});

	it('returns indexed document type in output and exposes available type metadata', async () => {
		const { service } = makeService({
			documents: [
				baseDocument({
					id: 'doc-presentation',
					documentType: 'investor_presentation',
					title: 'Apresentação de Resultados 4T25',
				}),
			],
		});

		const output = await service.search({ query: 'BBDC4' });

		expect(output.fallback.availableDocumentTypes).toEqual([
			'investor_presentation',
		]);
		expect(output.documents).toHaveLength(1);
		expect(output.documents[0].documentType).toBe('investor_presentation');
	});

	it('prioritizes exact ticker query and ignores fuzzy matches when exact match exists', async () => {
		const discoveryByTicker: Record<string, RiDocumentRecord[]> = {
			ITUB4: [
				baseDocument({
					id: 'ITUB4:material_fact:2026-02-14T00:00:00.000Z:0',
					ticker: 'ITUB4',
					company: 'Itaú Unibanco Holding S.A.',
					title: 'Fato Relevante - Atualização Estratégica',
					documentType: 'material_fact',
					publishedAt: '2026-02-14T00:00:00.000Z',
					source: {
						type: 'url',
						value: 'https://ri.example.com/itub4/fato-relevante.pdf',
					},
				}),
			],
			ITUB3: [
				baseDocument({
					id: 'ITUB3:earnings_release:2026-02-05T00:00:00.000Z:0',
					ticker: 'ITUB3',
					company: 'Itaú Unibanco PN',
					title: 'Release de Resultados 4T25',
					documentType: 'earnings_release',
					publishedAt: '2026-02-05T00:00:00.000Z',
					source: {
						type: 'url',
						value: 'https://ri.example.com/itub3/release.pdf',
					},
				}),
			],
		};

		const autocomplete: RiAssetAutocompletePort = {
			search: jest.fn().mockResolvedValue([
				{ ticker: 'ITUB3', company: 'Itaú Unibanco PN' },
				{ ticker: 'ITUB4', company: 'Itaú Unibanco Holding S.A.' },
			]),
		};
		const discovery: RiDocumentDiscoveryPort = {
			discover: jest
				.fn()
				.mockImplementation(
					async ({ ticker }) => discoveryByTicker[ticker] || []
				),
		};
		const resolver: RiDocumentLinkResolverPort = {
			resolve: jest.fn().mockResolvedValue(validResolution()),
		};
		const service = new RiDocumentCatalogService(
			autocomplete,
			discovery,
			resolver
		);

		const output = await service.search({ query: 'ITUB4' });

		expect(output.documents).toHaveLength(1);
		expect(output.documents[0].ticker).toBe('ITUB4');
		expect(discovery.discover).toHaveBeenCalledTimes(1);
		expect(discovery.discover).toHaveBeenCalledWith(
			expect.objectContaining({ ticker: 'ITUB4' })
		);
	});

	it('returns pdf url by document id after validation', async () => {
		const { service } = makeService();

		const output = await service.getDocumentPdf(
			'BBDC4:earnings_release:2026-02-06T00:00:00.000Z:0',
			'BBDC4'
		);

		expect(output).toEqual({ url: 'https://ri.example.com/bbdc4/4t25.pdf' });
	});

	it('retrieves current expected quarter earnings release when available', async () => {
		const { service } = makeService({
			matches: [{ ticker: 'VALE3', company: 'Vale S.A.' }],
			documents: [
				baseDocument({
					ticker: 'VALE3',
					company: 'Vale S.A.',
					period: '1T26',
					title: 'Release de Resultados 1T26',
					publishedAt: '2026-04-30T00:00:00.000Z',
					source: { type: 'url', value: 'https://vale.com/ri/1t26.pdf' },
				}),
				baseDocument({
					ticker: 'VALE3',
					company: 'Vale S.A.',
					period: '4T25',
					title: 'Release de Resultados 4T25',
					publishedAt: '2026-02-28T00:00:00.000Z',
					source: { type: 'url', value: 'https://vale.com/ri/4t25.pdf' },
				}),
			],
		});

		const output = await service.retrieveMostRelevantDocument({
			ticker: 'VALE3',
			asOfDate: '2026-05-10T00:00:00.000Z',
		});

		expect(output.status).toBe('found');
		expect(output.document?.period).toBe('1T26');
		expect(output.selection.applied).toBe('current_quarter_release');
		expect(output.selection.fallbackApplied).toBe(false);
	});

	it('falls back explicitly to previous quarter release when current quarter is unavailable', async () => {
		const { service } = makeService({
			matches: [{ ticker: 'VALE3', company: 'Vale S.A.' }],
			documents: [
				baseDocument({
					ticker: 'VALE3',
					company: 'Vale S.A.',
					period: '4T25',
					title: 'Release de Resultados 4T25',
					publishedAt: '2026-02-28T00:00:00.000Z',
					source: { type: 'url', value: 'https://vale.com/ri/4t25.pdf' },
				}),
			],
		});

		const output = await service.retrieveMostRelevantDocument({
			ticker: 'VALE3',
			asOfDate: '2026-05-10T00:00:00.000Z',
		});

		expect(output.status).toBe('found');
		expect(output.document?.period).toBe('4T25');
		expect(output.selection.applied).toBe('previous_quarter_release_fallback');
		expect(output.selection.fallbackApplied).toBe(true);
		expect(output.selection.fallbackReason).toBe(
			'ri_previous_quarter_release_fallback'
		);
		expect(output.warnings).toContain('ri_current_quarter_release_unavailable');
	});

	it('returns most recent requested type when no earnings release exists', async () => {
		const { service } = makeService({
			matches: [{ ticker: 'VALE3', company: 'Vale S.A.' }],
			documents: [
				baseDocument({
					ticker: 'VALE3',
					company: 'Vale S.A.',
					documentType: 'material_fact',
					title: 'Fato Relevante',
					publishedAt: '2026-04-01T00:00:00.000Z',
					source: {
						type: 'url',
						value: 'https://vale.com/ri/fato-relevante-1.pdf',
					},
				}),
				baseDocument({
					ticker: 'VALE3',
					company: 'Vale S.A.',
					documentType: 'material_fact',
					title: 'Fato Relevante - Atualização',
					publishedAt: '2026-04-25T00:00:00.000Z',
					source: {
						type: 'url',
						value: 'https://vale.com/ri/fato-relevante-2.pdf',
					},
				}),
			],
		});

		const output = await service.retrieveMostRelevantDocument({
			ticker: 'VALE3',
			documentType: 'material_fact',
		});

		expect(output.status).toBe('found');
		expect(output.document?.documentType).toBe('material_fact');
		expect(output.document?.publishedAt).toBe('2026-04-25T00:00:00.000Z');
		expect(output.selection.applied).toBe('requested_type');
	});

	it('returns structured unavailable state when ticker has no official source', async () => {
		const { service } = makeService({
			matches: [{ ticker: 'ABCD3', company: 'Empresa Não Mapeada' }],
			documents: [],
		});

		const output = await service.retrieveMostRelevantDocument({
			ticker: 'ABCD3',
		});

		expect(output.status).toBe('unavailable');
		expect(output.reason).toBe('source_not_resolved');
		expect(output.warnings).toContain('ri_official_source_not_found');
		expect(output.document).toBeNull();
	});
});
