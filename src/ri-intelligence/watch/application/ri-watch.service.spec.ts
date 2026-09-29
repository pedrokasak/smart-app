import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiDocumentContentPort } from 'src/ri-intelligence/application/ri-document-content.port';
import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { HeldTickerDirectory } from 'src/ri-intelligence/watch/application/ports/held-ticker-directory.port';
import { RiWatchStore } from 'src/ri-intelligence/watch/application/ports/ri-watch-store.port';
import { RiWatchConfig } from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchService } from 'src/ri-intelligence/watch/application/ri-watch.service';
import {
	RI_WATCH_MAX_ATTEMPTS,
	RiWatchDocument,
	RiWatchSummarySnapshot,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function record(
	link: string,
	over: Partial<RiDocumentRecord> = {}
): RiDocumentRecord {
	return {
		id: `PETR4:material_fact:${link}:cvm`,
		ticker: 'PETR4',
		company: 'Petrobras',
		title: 'Fato Relevante - Aquisição',
		documentType: 'material_fact',
		period: null,
		publishedAt: '2026-09-27T00:00:00.000Z',
		source: { type: 'url', value: link },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		...over,
	};
}

/** Store em memoria com a mesma semantica do repositorio Mongo. */
class InMemoryRiWatchStore implements RiWatchStore {
	readonly docs = new Map<string, RiWatchDocument>();

	async registerNew(records: RiDocumentRecord[], now: Date) {
		let inserted = 0;
		for (const rec of records) {
			const key = watchDocumentKey(rec);
			if (!key || this.docs.has(key)) continue;
			this.docs.set(key, {
				key,
				ticker: rec.ticker,
				documentType: rec.documentType,
				publishedAt: rec.publishedAt,
				record: rec,
				status: 'pending',
				attempts: 0,
				discoveredAt: now.toISOString(),
			});
			inserted += 1;
		}
		return inserted;
	}

	async findPending(limit: number) {
		return [...this.docs.values()]
			.filter(
				(d) => d.status === 'pending' && d.attempts < RI_WATCH_MAX_ATTEMPTS
			)
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.slice(0, limit);
	}

	async markSummarized(key: string, summary: RiWatchSummarySnapshot) {
		Object.assign(this.docs.get(key)!, { status: 'summarized', summary });
	}

	async markSkipped(key: string, reason: string) {
		Object.assign(this.docs.get(key)!, {
			status: 'skipped',
			lastError: reason,
		});
	}

	async recordFailure(key: string, reason: string) {
		const doc = this.docs.get(key)!;
		doc.attempts += 1;
		doc.lastError = reason;
		if (doc.attempts >= RI_WATCH_MAX_ATTEMPTS) doc.status = 'failed';
	}
}

describe('RiWatchService (TRA-240)', () => {
	let store: InMemoryRiWatchStore;
	let directory: jest.Mocked<HeldTickerDirectory>;
	let discovery: { discover: jest.Mock };
	let content: { fetchTextContent: jest.Mock };
	let summaries: { summarize: jest.Mock };
	let config: RiWatchConfig;

	const makeService = () =>
		new RiWatchService(
			store,
			directory,
			discovery as unknown as RiDocumentDiscoveryPort,
			content as unknown as RiDocumentContentPort,
			summaries as unknown as RiDocumentSummaryService,
			config
		);

	const aiSummary = {
		summary: {
			status: 'ai_generated',
			sourceLabel: 'ai_summary',
			highlights: ['Aquisição de 30% do ativo X por US$ 1,2 bi.'],
			narrative: null,
			limitations: [],
			citations: [
				{
					highlight: 'Aquisição de 30% do ativo X por US$ 1,2 bi.',
					excerpt: 'A Companhia adquiriu 30% do ativo X por US$ 1,2 bilhão.',
					page: 1,
				},
			],
		},
	};

	beforeEach(() => {
		store = new InMemoryRiWatchStore();
		directory = {
			heldStockTickers: jest.fn().mockResolvedValue(['PETR4']),
		};
		discovery = { discover: jest.fn().mockResolvedValue([]) };
		content = {
			fetchTextContent: jest
				.fn()
				.mockResolvedValue({ text: 'A Companhia adquiriu 30%...' }),
		};
		summaries = { summarize: jest.fn().mockResolvedValue(aiSummary) };
		config = { enabled: true, lookbackDays: 3, maxSummariesPerRun: 20 };
	});

	describe('scan', () => {
		it('looks back only the configured window on the official source', async () => {
			await makeService().scan(NOW);

			expect(discovery.discover).toHaveBeenCalledWith(
				expect.objectContaining({
					ticker: 'PETR4',
					dateFrom: new Date('2026-09-25T12:00:00.000Z'),
					dateTo: NOW,
				})
			);
		});

		it('registers only relevant documents, once', async () => {
			discovery.discover.mockResolvedValue([
				record('https://rad/fato'),
				record('https://rad/vmnd', { documentType: 'other_ri_document' }),
			]);
			const service = makeService();

			const first = await service.scan(NOW);
			const second = await service.scan(NOW);

			expect(first).toEqual({ tickers: 1, registered: 1, failedTickers: 0 });
			expect(second.registered).toBe(0);
			expect(store.docs.size).toBe(1);
		});

		// PETR3 e PETR4 tem o mesmo CNPJ: o mesmo documento volta para as duas
		// classes e precisa virar um registro so (e um resumo so).
		it('registers a document shared by two share classes once', async () => {
			directory.heldStockTickers.mockResolvedValue(['PETR3', 'PETR4']);
			discovery.discover.mockImplementation(async ({ ticker }) => [
				record('https://rad/fato-petrobras', { ticker }),
			]);

			const result = await makeService().scan(NOW);

			expect(result.registered).toBe(1);
			expect(store.docs.size).toBe(1);
		});

		it('keeps scanning when one ticker fails', async () => {
			directory.heldStockTickers.mockResolvedValue(['PETR4', 'VALE3']);
			discovery.discover
				.mockRejectedValueOnce(new Error('cvm down'))
				.mockResolvedValueOnce([
					record('https://rad/vale', { ticker: 'VALE3' }),
				]);

			const result = await makeService().scan(NOW);

			expect(result).toEqual({ tickers: 2, registered: 1, failedTickers: 1 });
		});
	});

	describe('processPending', () => {
		beforeEach(async () => {
			await store.registerNew([record('https://rad/fato')], NOW);
		});

		const onlyDoc = () => [...store.docs.values()][0];

		it('pre-generates the verified summary from the exact discovered record', async () => {
			const result = await makeService().processPending(NOW);

			expect(result).toEqual({ summarized: 1, skipped: 0, failed: 0 });
			const [input] = summaries.summarize.mock.calls[0];
			// Mesmo id/titulo/empresa que o web manda: e isso que faz o resumo
			// pre-gerado ser cache hit quando alguem abrir o documento.
			expect(input.document.id).toBe(onlyDoc().record.id);
			expect(input.document.contentStatus).toBe('extracted');
			expect(input.allowAi).toBe(true);
			expect(onlyDoc().status).toBe('summarized');
			expect(onlyDoc().summary).toEqual({
				highlights: aiSummary.summary.highlights,
				citations: aiSummary.summary.citations,
			});
		});

		it('skips for good when the PDF has no text layer', async () => {
			content.fetchTextContent.mockResolvedValue({
				text: null,
				reason: 'empty_after_extract',
			});

			await makeService().processPending(NOW);

			expect(onlyDoc().status).toBe('skipped');
			expect(summaries.summarize).not.toHaveBeenCalled();
		});

		it('retries a transient download failure up to the attempt cap', async () => {
			content.fetchTextContent.mockResolvedValue({
				text: null,
				reason: 'fetch_failed',
			});
			const service = makeService();

			for (let run = 0; run < RI_WATCH_MAX_ATTEMPTS + 1; run += 1) {
				await service.processPending(NOW);
			}

			expect(onlyDoc().status).toBe('failed');
			expect(onlyDoc().attempts).toBe(RI_WATCH_MAX_ATTEMPTS);
			expect(content.fetchTextContent).toHaveBeenCalledTimes(
				RI_WATCH_MAX_ATTEMPTS
			);
		});

		it('skips documents too short to summarize', async () => {
			summaries.summarize.mockResolvedValue({
				summary: {
					status: 'insufficient_content',
					sourceLabel: 'structured_fallback',
					highlights: [],
					limitations: ['ri_content_insufficient_for_summary'],
				},
			});

			await makeService().processPending(NOW);

			expect(onlyDoc().status).toBe('skipped');
		});

		it('retries when the AI summary fails', async () => {
			summaries.summarize.mockResolvedValue({
				summary: {
					status: 'ai_failed',
					sourceLabel: 'structured_fallback',
					highlights: [],
					limitations: ['ri_ai_summary_failed'],
				},
			});

			const result = await makeService().processPending(NOW);

			expect(result.failed).toBe(1);
			expect(onlyDoc().status).toBe('pending');
			expect(onlyDoc().lastError).toBe('ri_ai_summary_failed');
		});

		it('caps how many documents are summarized per run', async () => {
			await store.registerNew(
				[record('https://rad/a'), record('https://rad/b')],
				NOW
			);
			config.maxSummariesPerRun = 2;

			const result = await makeService().processPending(NOW);

			expect(result.summarized).toBe(2);
			expect(summaries.summarize).toHaveBeenCalledTimes(2);
		});

		it('an unexpected error on one document does not stop the others', async () => {
			await store.registerNew([record('https://rad/b')], NOW);
			summaries.summarize
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce(aiSummary);

			const result = await makeService().processPending(NOW);

			expect(result).toEqual({ summarized: 1, skipped: 0, failed: 1 });
		});
	});
});
