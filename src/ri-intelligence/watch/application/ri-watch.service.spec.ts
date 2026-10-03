import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiDocumentContentPort } from 'src/ri-intelligence/application/ri-document-content.port';
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { HeldTickerDirectory } from 'src/ri-intelligence/watch/application/ports/held-ticker-directory.port';
import { IssuerCodeDirectory } from 'src/ri-intelligence/watch/application/ports/issuer-code-directory.port';
import { RiDeliveryFeedPort } from 'src/ri-intelligence/watch/application/ports/ri-delivery-feed.port';
import { InMemoryRiWatchStore } from 'src/ri-intelligence/watch/application/in-memory-ri-watch-store.fixture';
import { RiWatchConfig } from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchService } from 'src/ri-intelligence/watch/application/ri-watch.service';
import { RiDelivery } from 'src/ri-intelligence/watch/domain/ri-delivery';
import { RI_WATCH_MAX_ATTEMPTS } from 'src/ri-intelligence/watch/domain/ri-watch';

const NOW = new Date('2026-09-28T12:00:00.000Z');

/** Codigo CVM da Petrobras: as duas classes (PETR3/PETR4) compartilham. */
const PETROBRAS_CVM = '9512';

/** Entrega do ENET da Petrobras; relevante (fato relevante) por padrao. */
function delivery(
	protocol: string,
	over: Partial<RiDelivery> = {}
): RiDelivery {
	return {
		cvmCode: PETROBRAS_CVM,
		company: 'PETROLEO BRASILEIRO S.A. PETROBRAS',
		category: 'Fato Relevante',
		type: null,
		subject: 'Aquisição',
		referenceDate: '2026-09-28',
		deliveredOn: '2026-09-28',
		protocol,
		downloadUrl: `https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=${protocol}`,
		active: true,
		...over,
	};
}

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

describe('RiWatchService (TRA-240)', () => {
	let store: InMemoryRiWatchStore;
	let directory: jest.Mocked<HeldTickerDirectory>;
	let discovery: { discover: jest.Mock };
	let dailyFeed: jest.Mocked<RiDeliveryFeedPort>;
	let issuerCodes: jest.Mocked<IssuerCodeDirectory>;
	let content: { fetchTextContent: jest.Mock };
	let summaries: { summarize: jest.Mock };
	let config: RiWatchConfig;
	// Resolver de verdade (TRA-253), sem cache de texto: os testes seguem
	// dizendo o que o PDF devolve.
	const noTextCache = {
		get: jest.fn().mockResolvedValue(null),
		set: jest.fn().mockResolvedValue(undefined),
	};

	const makeService = () =>
		new RiWatchService(
			store,
			directory,
			discovery as unknown as RiDocumentDiscoveryPort,
			dailyFeed,
			issuerCodes,
			new RiDocumentContentResolver(
				content as unknown as RiDocumentContentPort,
				noTextCache
			),
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
			heldFiiTickers: jest.fn().mockResolvedValue([]),
		};
		discovery = { discover: jest.fn().mockResolvedValue([]) };
		dailyFeed = { listDeliveries: jest.fn().mockResolvedValue([]) };
		issuerCodes = {
			resolveCvmCode: jest
				.fn()
				.mockImplementation(async (ticker: string) =>
					ticker.startsWith('PETR') ? PETROBRAS_CVM : null
				),
		};
		content = {
			fetchTextContent: jest
				.fn()
				.mockResolvedValue({ text: 'A Companhia adquiriu 30%...' }),
		};
		summaries = { summarize: jest.fn().mockResolvedValue(aiSummary) };
		config = {
			enabled: true,
			lookbackDays: 3,
			maxSummariesPerRun: 20,
			dailyFeedEnabled: true,
			notifyEnabled: false,
			notifyMaxAgeDays: 3,
			indexEnabled: false,
			fiiEnabled: false,
		};
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

			expect(first).toEqual({
				tickers: 1,
				registered: 1,
				failedTickers: 0,
				dailyFeed: 'ok',
			});
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

			expect(result).toEqual({
				tickers: 2,
				registered: 1,
				failedTickers: 1,
				dailyFeed: 'ok',
			});
		});
	});

	describe('scan: daily ENET feed (TRA-260)', () => {
		it('registers a held company delivery on the day it is delivered', async () => {
			dailyFeed.listDeliveries.mockResolvedValue([
				delivery('1001'),
				// Companhia fora de qualquer carteira.
				delivery('1002', { cvmCode: '99999', company: 'OUTRA S.A.' }),
				// Comunicado que a propria CVM classifica como nao relevante.
				delivery('1003', {
					category: 'Comunicado ao Mercado',
					type: 'Outros Comunicados Não Considerados Fatos Relevantes',
				}),
			]);

			const result = await makeService().scan(NOW);

			expect(result).toEqual({
				tickers: 1,
				registered: 1,
				failedTickers: 0,
				dailyFeed: 'ok',
			});
			const [doc] = [...store.docs.values()];
			expect(doc.ticker).toBe('PETR4');
			expect(doc.record.deliveryProtocol).toBe('1001');
			expect(doc.record.source.value).toContain('numProtocolo=1001');
		});

		it('asks the ENET once per run, for the last two days', async () => {
			directory.heldStockTickers.mockResolvedValue(['PETR4', 'VALE3']);
			issuerCodes.resolveCvmCode.mockImplementation(async (ticker) =>
				ticker === 'VALE3' ? '4170' : PETROBRAS_CVM
			);

			await makeService().scan(NOW);

			expect(dailyFeed.listDeliveries).toHaveBeenCalledTimes(1);
			expect(dailyFeed.listDeliveries).toHaveBeenCalledWith(
				new Date('2026-09-26T12:00:00.000Z'),
				NOW
			);
		});

		// O mesmo documento chega de novo pelo IPE semanal, com outro link e
		// outro titulo. A identidade e o protocolo de entrega: um registro so.
		it('does not register again what the weekly IPE brings later', async () => {
			dailyFeed.listDeliveries.mockResolvedValue([delivery('1001')]);
			discovery.discover.mockResolvedValue([
				record('https://dados.cvm.gov.br/ipe/1001', {
					deliveryProtocol: '1001',
					cvmCategory: 'Fato Relevante',
				}),
			]);

			const result = await makeService().scan(NOW);

			expect(result.registered).toBe(1);
			expect(store.docs.size).toBe(1);
		});

		// PETR3 e PETR4 tem o mesmo codigo CVM: um registro so, e sempre sob
		// a mesma classe, qualquer que seja a ordem da carteira.
		it('files a two-class company delivery under one ticker, deterministically', async () => {
			directory.heldStockTickers.mockResolvedValue(['PETR4', 'PETR3']);
			dailyFeed.listDeliveries.mockResolvedValue([delivery('1001')]);

			await makeService().scan(NOW);

			expect([...store.docs.values()].map((d) => d.ticker)).toEqual(['PETR3']);
		});

		// Captcha ligado, fora do ar, formato novo: a rodada segue com o IPE.
		it('falls back to the weekly IPE when the ENET fails', async () => {
			dailyFeed.listDeliveries.mockRejectedValue(
				new Error('enet_rejected: Captcha inválido')
			);
			discovery.discover.mockResolvedValue([record('https://rad/fato')]);

			const result = await makeService().scan(NOW);

			expect(result).toEqual({
				tickers: 1,
				registered: 1,
				failedTickers: 0,
				dailyFeed: 'failed',
			});
		});

		it('does not query the ENET when switched off', async () => {
			config.dailyFeedEnabled = false;

			const result = await makeService().scan(NOW);

			expect(dailyFeed.listDeliveries).not.toHaveBeenCalled();
			expect(result.dailyFeed).toBe('disabled');
			expect(discovery.discover).toHaveBeenCalled();
		});

		// Carteira com acoes e nenhum codigo CVM: registro da B3 mudou. O
		// status diferente e o aviso no log evitam uma fonte muda em silencio.
		it('skips the ENET when no held ticker has a known CVM code', async () => {
			issuerCodes.resolveCvmCode.mockResolvedValue(null);

			const result = await makeService().scan(NOW);

			expect(dailyFeed.listDeliveries).not.toHaveBeenCalled();
			expect(result.dailyFeed).toBe('skipped');
		});

		it('skips the ENET when nothing is held', async () => {
			directory.heldStockTickers.mockResolvedValue([]);

			const result = await makeService().scan(NOW);

			expect(dailyFeed.listDeliveries).not.toHaveBeenCalled();
			expect(result.dailyFeed).toBe('skipped');
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
			// TRA-260: publica tambem pela chave do protocolo da CVM.
			expect(input.serverDiscovered).toBe(true);
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
