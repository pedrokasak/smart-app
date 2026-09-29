import { RiDocumentContentPort } from 'src/ri-intelligence/application/ri-document-content.port';
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import { RiKnowledgePort } from 'src/ri-intelligence/application/ri-knowledge.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { InMemoryRiWatchStore } from 'src/ri-intelligence/watch/application/in-memory-ri-watch-store.fixture';
import {
	RI_WATCH_DEFAULTS,
	RiWatchConfig,
} from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchIndexer } from 'src/ri-intelligence/watch/application/ri-watch.indexer';
import { watchDocumentKey } from 'src/ri-intelligence/watch/domain/ri-watch';

const NOW = new Date('2026-09-29T15:00:00.000Z');

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
		publishedAt: '2026-09-28T00:00:00.000Z',
		source: { type: 'url', value: link },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		cvmCategory: 'Fato Relevante',
		cvmType: null,
		...over,
	};
}

describe('RiWatchIndexer (TRA-264)', () => {
	let store: InMemoryRiWatchStore;
	let content: { fetchTextContent: jest.Mock };
	let textCache: { get: jest.Mock; set: jest.Mock };
	let knowledge: jest.Mocked<RiKnowledgePort>;
	let config: RiWatchConfig;

	const makeIndexer = () =>
		new RiWatchIndexer(
			store,
			new RiDocumentContentResolver(
				content as unknown as RiDocumentContentPort,
				textCache
			),
			knowledge,
			config
		);

	/** Registra e leva o documento ate um estado terminado. */
	async function processed(
		rec: RiDocumentRecord,
		finish: 'summarized' | 'skipped' = 'summarized'
	): Promise<string> {
		await store.registerNew([rec], NOW);
		const key = watchDocumentKey(rec)!;
		if (finish === 'summarized') {
			await store.markSummarized(key, { highlights: ['x'], citations: [] });
		} else {
			await store.markSkipped(key, 'content_empty_after_extract');
		}
		return key;
	}

	beforeEach(() => {
		store = new InMemoryRiWatchStore();
		content = {
			fetchTextContent: jest.fn().mockResolvedValue({
				text: 'A Companhia adquiriu 30%... -- 1 of 1 --',
			}),
		};
		// O texto que o processamento acabou de ler costuma estar aqui.
		textCache = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn().mockResolvedValue(undefined),
		};
		knowledge = {
			index: jest.fn().mockResolvedValue('indexed'),
			ask: jest.fn(),
		};
		config = { ...RI_WATCH_DEFAULTS, enabled: true, indexEnabled: true };
	});

	it('does nothing while switched off', async () => {
		config.indexEnabled = false;
		await processed(record('https://rad/fato'));

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result).toEqual({ documents: 0, indexed: 0, failed: 0 });
		expect(knowledge.index).not.toHaveBeenCalled();
	});

	it('sends the text with the document metadata and the issuer', async () => {
		const key = await processed(record('https://rad/fato'));

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result).toEqual({ documents: 1, indexed: 1, failed: 0 });
		const [document, text] = knowledge.index.mock.calls[0];
		expect(document).toEqual({
			key,
			issuer: 'PETR',
			ticker: 'PETR4',
			company: 'Petrobras',
			title: 'Fato Relevante - Aquisição',
			category: 'Fato Relevante',
			documentType: 'material_fact',
			period: null,
			publishedAt: '2026-09-28',
			sourceUrl: 'https://rad/fato',
		});
		expect(text).toContain('A Companhia adquiriu 30%');
		expect(store.docs.get(key)?.indexedAt).toBe(NOW.toISOString());
	});

	// O texto quase sempre vem do cache: o PDF nao e baixado de novo.
	it('uses the cached text instead of downloading again', async () => {
		textCache.get.mockResolvedValue('texto guardado pelo processamento');
		await processed(record('https://rad/fato'));

		await makeIndexer().indexProcessed(NOW);

		expect(content.fetchTextContent).not.toHaveBeenCalled();
		expect(knowledge.index.mock.calls[0][1]).toBe(
			'texto guardado pelo processamento'
		);
	});

	// PDF escaneado nunca vai ter texto: sai da fila sem ir ao acervo.
	it('closes a document that will never have text', async () => {
		content.fetchTextContent.mockResolvedValue({
			text: null,
			reason: 'empty_after_extract',
		});
		const key = await processed(record('https://rad/scan'), 'skipped');

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result).toEqual({ documents: 1, indexed: 0, failed: 0 });
		expect(knowledge.index).not.toHaveBeenCalled();
		expect(store.docs.get(key)?.indexedAt).toBe(NOW.toISOString());
	});

	it('keeps in the queue a document whose download failed for now', async () => {
		content.fetchTextContent.mockResolvedValue({
			text: null,
			reason: 'fetch_failed',
		});
		const key = await processed(record('https://rad/fato'));

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result.failed).toBe(1);
		expect(store.docs.get(key)?.indexedAt).toBeNull();
	});

	it('keeps a document in the queue when the base is down, without stopping the others', async () => {
		const failing = await processed(record('https://rad/a'));
		const ok = await processed(
			record('https://rad/b', { publishedAt: '2026-09-27T00:00:00.000Z' })
		);
		knowledge.index
			.mockRejectedValueOnce(new Error('trackerr-ia fora'))
			.mockResolvedValueOnce('indexed');

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result).toEqual({ documents: 1, indexed: 1, failed: 1 });
		expect(store.docs.get(failing)?.indexedAt).toBeNull();
		expect(store.docs.get(ok)?.indexedAt).toBe(NOW.toISOString());
	});

	it('never indexes a document still waiting to be processed', async () => {
		await store.registerNew([record('https://rad/fato')], NOW);

		const result = await makeIndexer().indexProcessed(NOW);

		expect(result.documents).toBe(0);
		expect(knowledge.index).not.toHaveBeenCalled();
	});

	it('does not index the same document twice', async () => {
		await processed(record('https://rad/fato'));
		const indexer = makeIndexer();

		await indexer.indexProcessed(NOW);
		await indexer.indexProcessed(NOW);

		expect(knowledge.index).toHaveBeenCalledTimes(1);
	});
});
