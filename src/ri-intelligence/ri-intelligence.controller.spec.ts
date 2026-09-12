import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';

describe('RiIntelligenceController', () => {
	const mockCatalogService = {
		autocomplete: jest.fn(),
		search: jest.fn(),
		retrieveMostRelevantDocument: jest.fn(),
		getDocumentPdf: jest.fn(),
	};
	const mockSummaryService = {
		summarize: jest.fn(),
	};

	let controller: RiIntelligenceController;

	beforeEach(() => {
		jest.clearAllMocks();
		controller = new RiIntelligenceController(
			mockCatalogService as unknown as RiDocumentCatalogService,
			mockSummaryService as unknown as RiDocumentSummaryService
		);
	});

	it('delegates documents search with parsed document type', async () => {
		mockCatalogService.search.mockResolvedValue({
			documents: [],
			total: 0,
			warnings: [],
			matches: [],
		});

		await controller.getDocuments('BBDC4', 'earnings_release', '20');

		expect(mockCatalogService.search).toHaveBeenCalledWith({
			query: 'BBDC4',
			documentType: 'earnings_release',
			limit: 20,
		});
	});

	it('delegates autocomplete query', async () => {
		mockCatalogService.autocomplete.mockResolvedValue([
			{ ticker: 'BBDC4', company: 'Banco Bradesco S.A.' },
		]);

		const output = await controller.autocomplete('brad', '5');

		expect(mockCatalogService.autocomplete).toHaveBeenCalledWith('brad', 5);
		expect(output).toEqual([
			{ ticker: 'BBDC4', company: 'Banco Bradesco S.A.' },
		]);
	});

	it('ignores unknown document type in filters', async () => {
		mockCatalogService.search.mockResolvedValue({
			documents: [],
			total: 0,
			warnings: [],
			matches: [],
		});

		await controller.getDocuments('BBDC4', 'unknown_type', '20');

		expect(mockCatalogService.search).toHaveBeenCalledWith({
			query: 'BBDC4',
			documentType: undefined,
			limit: 20,
		});
	});

	it('delegates relevant document retrieval with parsed document type', async () => {
		mockCatalogService.retrieveMostRelevantDocument.mockResolvedValue({
			status: 'unavailable',
		});

		await controller.getMostRelevantDocument('VALE3', 'earnings_release');

		expect(
			mockCatalogService.retrieveMostRelevantDocument
		).toHaveBeenCalledWith({
			ticker: 'VALE3',
			documentType: 'earnings_release',
		});
	});

	it('parses and forwards dateFrom/dateTo to documents search', async () => {
		mockCatalogService.search.mockResolvedValue({
			documents: [],
			total: 0,
			warnings: [],
			matches: [],
		});

		await controller.getDocuments(
			'BBDC4',
			'earnings_release',
			'20',
			'2025-01-01',
			'2025-12-31'
		);

		expect(mockCatalogService.search).toHaveBeenCalledWith({
			query: 'BBDC4',
			documentType: 'earnings_release',
			limit: 20,
			dateFrom: new Date('2025-01-01').toISOString(),
			dateTo: new Date('2025-12-31').toISOString(),
		});
	});

	it('forwards dateFrom/dateTo for relevant document retrieval', async () => {
		mockCatalogService.retrieveMostRelevantDocument.mockResolvedValue({
			status: 'unavailable',
		});

		await controller.getMostRelevantDocument(
			'VALE3',
			'earnings_release',
			'2025-01-01',
			'2025-06-30'
		);

		expect(
			mockCatalogService.retrieveMostRelevantDocument
		).toHaveBeenCalledWith({
			ticker: 'VALE3',
			documentType: 'earnings_release',
			dateFrom: new Date('2025-01-01').toISOString(),
			dateTo: new Date('2025-06-30').toISOString(),
		});
	});

	it('omits dateFrom/dateTo when not provided (additive contract)', async () => {
		mockCatalogService.search.mockResolvedValue({
			documents: [],
			total: 0,
			warnings: [],
			matches: [],
		});

		await controller.getDocuments('BBDC4', 'earnings_release', '20');

		expect(mockCatalogService.search).toHaveBeenCalledWith({
			query: 'BBDC4',
			documentType: 'earnings_release',
			limit: 20,
			dateFrom: undefined,
			dateTo: undefined,
		});
	});

	it('rejects an invalid dateFrom with bad request', async () => {
		await expect(
			controller.getDocuments('BBDC4', 'earnings_release', '20', 'not-a-date')
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('returns not found when requested pdf does not exist', async () => {
		mockCatalogService.getDocumentPdf.mockResolvedValue(null);

		await expect(
			controller.getDocumentPdf('unknown-doc-id', 'BBDC4')
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it('throws bad request when summary payload has no document', async () => {
		await expect(controller.summarize({})).rejects.toBeInstanceOf(
			BadRequestException
		);
	});

	it('delegates summary generation for valid payload', async () => {
		mockSummaryService.summarize.mockResolvedValue({
			document: {
				id: 'BBDC4:doc',
				ticker: 'BBDC4',
				company: 'Banco Bradesco S.A.',
				documentType: 'earnings_release',
				period: '4T25',
				publishedAt: '2026-02-06T00:00:00.000Z',
			},
			summary: {
				status: 'insufficient_content',
				highlights: [],
				narrative: null,
				limitations: ['ri_content_insufficient_for_summary'],
				sourceLabel: 'structured_fallback',
			},
			structuredSignals: {
				revenue: { detected: false, direction: 'unknown', evidence: [] },
				profit: { detected: false, direction: 'unknown', evidence: [] },
				margin: { detected: false, direction: 'unknown', evidence: [] },
				indebtedness: { detected: false, direction: 'unknown', evidence: [] },
				capex: { detected: false, direction: 'unknown', evidence: [] },
				guidance: { detected: false, direction: 'unknown', evidence: [] },
				risks: { detected: false, direction: 'unknown', evidence: [] },
				toneShift: { detected: false, direction: 'unknown', evidence: [] },
			},
			cache: {
				key: null,
				hit: false,
				ttlSeconds: null,
			},
			cost: {
				aiCalls: 0,
				tokenUsageEstimate: 0,
			},
		});

		await controller.summarize({
			document: {
				id: 'BBDC4:doc',
				ticker: 'BBDC4',
				company: 'Banco Bradesco S.A.',
				title: 'Release',
				documentType: 'earnings_release',
				period: '4T25',
				publishedAt: '2026-02-06T00:00:00.000Z',
				source: { type: 'url', value: 'https://ri.example.com/doc.pdf' },
				classification: {
					method: 'deterministic_rules',
					confidence: 'high',
				},
				contentStatus: 'metadata_only',
			},
			content: 'conteudo curto',
		});

		expect(mockSummaryService.summarize).toHaveBeenCalledTimes(1);
	});
});
