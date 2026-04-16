import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { CatalogRiDocumentQueryAdapter } from 'src/ri-intelligence/infrastructure/catalog-ri-document-query.adapter';

describe('CatalogRiDocumentQueryAdapter', () => {
	const baseDocument = {
		id: 'VALE3:earnings_release:2026-04-30T00:00:00.000Z:0',
		ticker: 'VALE3',
		company: 'Vale S.A.',
		title: 'Release 1T26',
		documentType: 'earnings_release' as const,
		period: '1T26',
		publishedAt: '2026-04-30T00:00:00.000Z',
		source: { type: 'url' as const, value: 'https://vale.com/ri/1t26.pdf' },
		classification: {
			method: 'deterministic_rules' as const,
			confidence: 'high' as const,
		},
		contentStatus: 'metadata_only' as const,
	};

	it('returns latest document through retrieval flow', async () => {
		const catalog = {
			retrieveMostRelevantDocument: jest.fn().mockResolvedValue({
				status: 'found',
				document: baseDocument,
			}),
		} as unknown as RiDocumentCatalogService;
		const adapter = new CatalogRiDocumentQueryAdapter(catalog);

		const output = await adapter.getLatestByTicker('VALE3');

		expect(output?.document.id).toBe(baseDocument.id);
		expect(catalog.retrieveMostRelevantDocument).toHaveBeenCalledWith({
			ticker: 'VALE3',
			documentType: 'earnings_release',
		});
	});

	it('falls back to latest safe RI document when earnings release is unavailable', async () => {
		const fallbackDocument = {
			...baseDocument,
			id: 'VALE3:material_fact:2026-05-07T00:00:00.000Z:0',
			title: 'Fato Relevante',
			documentType: 'material_fact' as const,
		};

		const catalog = {
			retrieveMostRelevantDocument: jest
				.fn()
				.mockResolvedValueOnce({
					status: 'unavailable',
					document: null,
				})
				.mockResolvedValueOnce({
					status: 'found',
					document: fallbackDocument,
				}),
		} as unknown as RiDocumentCatalogService;
		const adapter = new CatalogRiDocumentQueryAdapter(catalog);

		const output = await adapter.getLatestByTicker('VALE3');

		expect(output?.document.id).toBe(fallbackDocument.id);
		expect(catalog.retrieveMostRelevantDocument).toHaveBeenNthCalledWith(1, {
			ticker: 'VALE3',
			documentType: 'earnings_release',
		});
		expect(catalog.retrieveMostRelevantDocument).toHaveBeenNthCalledWith(2, {
			ticker: 'VALE3',
		});
	});

	it('returns previous comparable document by same type and older publication date', async () => {
		const catalog = {
			search: jest.fn().mockResolvedValue({
				documents: [
					baseDocument,
					{
						...baseDocument,
						id: 'VALE3:earnings_release:2026-02-28T00:00:00.000Z:0',
						period: '4T25',
						publishedAt: '2026-02-28T00:00:00.000Z',
					},
				],
			}),
		} as unknown as RiDocumentCatalogService;
		const adapter = new CatalogRiDocumentQueryAdapter(catalog);

		const output = await adapter.getPreviousComparable({
			document: baseDocument,
			content: null,
		});

		expect(output?.document.period).toBe('4T25');
		expect(catalog.search).toHaveBeenCalledWith({
			query: 'VALE3',
			documentType: 'earnings_release',
			limit: 40,
		});
	});
});
