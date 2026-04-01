import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiSummaryCachePort } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { RiSummarySynthesizerPort } from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

describe('RiDocumentSummaryService', () => {
	const baseDocument: RiDocumentRecord = {
		id: 'ri-doc-1',
		ticker: 'ITUB4',
		company: 'Itaú Unibanco',
		title: 'Release de Resultados 4T25',
		documentType: 'earnings_release',
		period: '4T25',
		publishedAt: '2026-02-10T00:00:00.000Z',
		source: {
			type: 'url',
			value: 'https://ri.itau.com/release-4t25.pdf',
		},
		classification: {
			method: 'provided',
			confidence: 'high',
		},
		contentStatus: 'metadata_only',
	};

	const longContent = `
		A companhia reportou crescimento de receita no trimestre, com aumento de faturamento em relação ao período anterior.
		O lucro líquido apresentou alta e a margem EBITDA teve expansão relevante.
		A administração comentou guidance para o próximo ano e citou riscos macroeconômicos.
		O endividamento teve redução com estratégia de desalavancagem.
	`.repeat(4);

	it('returns ai summary successfully and stores cache', async () => {
		const cache: RiSummaryCachePort<any> = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn().mockResolvedValue(undefined),
		};
		const synthesizer: RiSummarySynthesizerPort = {
			summarize: jest.fn().mockResolvedValue({
				highlights: ['Receita em alta', 'Lucro cresceu', 'Guidance reiterado'],
				narrative: 'Resumo da RI com foco em crescimento e riscos monitorados.',
				metadata: { tokenUsage: 321, model: 'test-model' },
			}),
		};
		const service = new RiDocumentSummaryService(synthesizer, cache);

		const output = await service.summarize({
			document: baseDocument,
			content: longContent,
		});

		expect(output.summary.status).toBe('ai_generated');
		expect(output.summary.sourceLabel).toBe('ai_summary');
		expect(output.summary.highlights).toEqual(
			expect.arrayContaining(['Receita em alta'])
		);
		expect(output.structuredSignals.revenue.detected).toBe(true);
		expect(output.cost.aiCalls).toBe(1);
		expect(cache.set).toHaveBeenCalled();
	});

	it('returns insufficient content without calling ai', async () => {
		const cache: RiSummaryCachePort<any> = {
			get: jest.fn(),
			set: jest.fn(),
		};
		const synthesizer: RiSummarySynthesizerPort = {
			summarize: jest.fn(),
		};
		const service = new RiDocumentSummaryService(synthesizer, cache);

		const output = await service.summarize({
			document: baseDocument,
			content: 'Texto curto.',
		});

		expect(output.summary.status).toBe('insufficient_content');
		expect(output.summary.limitations).toEqual(
			expect.arrayContaining(['ri_content_insufficient_for_summary'])
		);
		expect(synthesizer.summarize).not.toHaveBeenCalled();
		expect(output.cost.aiCalls).toBe(0);
	});

	it('falls back safely when ai summarization fails', async () => {
		const cache: RiSummaryCachePort<any> = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn(),
		};
		const synthesizer: RiSummarySynthesizerPort = {
			summarize: jest.fn().mockRejectedValue(new Error('ai down')),
		};
		const service = new RiDocumentSummaryService(synthesizer, cache);

		const output = await service.summarize({
			document: baseDocument,
			content: longContent,
		});

		expect(output.summary.status).toBe('ai_failed');
		expect(output.summary.sourceLabel).toBe('structured_fallback');
		expect(output.summary.limitations).toEqual(
			expect.arrayContaining(['ri_ai_summary_failed'])
		);
		expect(output.structuredSignals.profit.detected).toBe(true);
	});

	it('returns cached summary when cache hit occurs', async () => {
		const cachedValue = {
			document: {
				id: baseDocument.id,
				ticker: baseDocument.ticker,
				company: baseDocument.company,
				documentType: baseDocument.documentType,
				period: baseDocument.period,
				publishedAt: baseDocument.publishedAt,
			},
			summary: {
				status: 'ai_generated',
				highlights: ['Cached insight'],
				narrative: 'Cached narrative',
				limitations: [],
				sourceLabel: 'ai_summary',
			},
			structuredSignals: {
				revenue: { detected: true, direction: 'up', evidence: [] },
				profit: { detected: true, direction: 'up', evidence: [] },
				margin: { detected: false, direction: 'unknown', evidence: [] },
				indebtedness: { detected: false, direction: 'unknown', evidence: [] },
				guidance: { detected: false, direction: 'unknown', evidence: [] },
				risks: { detected: false, direction: 'unknown', evidence: [] },
				toneShift: { detected: false, direction: 'unknown', evidence: [] },
			},
			cache: { key: 'k', hit: false, ttlSeconds: 100 },
			cost: { aiCalls: 1, tokenUsageEstimate: 100 },
		};
		const cache: RiSummaryCachePort<any> = {
			get: jest.fn().mockResolvedValue(cachedValue),
			set: jest.fn(),
		};
		const synthesizer: RiSummarySynthesizerPort = {
			summarize: jest.fn(),
		};
		const service = new RiDocumentSummaryService(synthesizer, cache);

		const output = await service.summarize({
			document: baseDocument,
			content: longContent,
		});

		expect(output.summary.status).toBe('cached_ai');
		expect(output.summary.highlights).toEqual(['Cached insight']);
		expect(output.cost.aiCalls).toBe(0);
		expect(synthesizer.summarize).not.toHaveBeenCalled();
	});
});
