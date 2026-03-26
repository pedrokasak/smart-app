import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiIntelligenceController } from 'src/ri-intelligence/ri-intelligence.controller';

describe('RiIntelligenceController', () => {
	const mockCatalogService = {
		autocomplete: jest.fn(),
		search: jest.fn(),
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
			structuredSignals: {},
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
