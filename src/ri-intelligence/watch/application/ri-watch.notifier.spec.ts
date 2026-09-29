import { EventPublisher } from 'src/events/application/ports/event-publisher.port';
import { DomainEvent } from 'src/events/domain/domain-event';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { InMemoryRiWatchStore } from 'src/ri-intelligence/watch/application/in-memory-ri-watch-store.fixture';
import {
	RiHolder,
	RiHolderDirectory,
} from 'src/ri-intelligence/watch/application/ports/ri-holder-directory.port';
import { RiSummaryEntitlement } from 'src/ri-intelligence/watch/application/ports/ri-summary-entitlement.port';
import {
	RI_WATCH_DEFAULTS,
	RiWatchConfig,
} from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchNotifier } from 'src/ri-intelligence/watch/application/ri-watch.notifier';
import { watchDocumentKey } from 'src/ri-intelligence/watch/domain/ri-watch';

const NOW = new Date('2026-09-29T15:00:00.000Z');

const SOURCE =
	'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1571942';

function record(over: Partial<RiDocumentRecord> = {}): RiDocumentRecord {
	return {
		id: 'PETR3:material_fact:2026-09-29T00:00:00.000Z:1571942:enet',
		ticker: 'PETR3',
		company: 'PETROLEO BRASILEIRO S.A. PETROBRAS',
		title: 'Fato Relevante - Aquisição',
		documentType: 'material_fact',
		period: null,
		publishedAt: '2026-09-29T00:00:00.000Z',
		source: { type: 'url', value: SOURCE },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		deliveryProtocol: '1571942',
		cvmCategory: 'Fato Relevante',
		cvmType: null,
		...over,
	};
}

const HIGHLIGHTS = [
	'Aquisição de 30% do ativo X por US$ 1,2 bi.',
	'Pagamento em duas parcelas.',
	'Fechamento previsto para o 1T27.',
	'Quarto destaque que nao cabe no aviso.',
];

describe('RiWatchNotifier (TRA-261)', () => {
	let store: InMemoryRiWatchStore;
	let holders: jest.Mocked<RiHolderDirectory>;
	let entitlement: jest.Mocked<RiSummaryEntitlement>;
	let published: DomainEvent<any>[];
	let publisher: EventPublisher;
	let config: RiWatchConfig;

	const makeNotifier = () =>
		new RiWatchNotifier(store, holders, entitlement, publisher, config);

	/** Registra e leva o documento ate um estado terminado. */
	async function processed(
		rec: RiDocumentRecord,
		finish: 'summarized' | 'skipped' = 'summarized'
	): Promise<string> {
		await store.registerNew([rec], NOW);
		const key = watchDocumentKey(rec)!;
		if (finish === 'summarized') {
			await store.markSummarized(key, {
				highlights: HIGHLIGHTS,
				citations: [],
			});
		} else {
			await store.markSkipped(key, 'content_empty_after_extract');
		}
		return key;
	}

	const holdersOf = (...list: RiHolder[]) =>
		holders.holdersOfIssuer.mockResolvedValue(list);

	beforeEach(() => {
		store = new InMemoryRiWatchStore();
		holders = { holdersOfIssuer: jest.fn().mockResolvedValue([]) };
		entitlement = {
			usersWithAiSummary: jest.fn().mockResolvedValue(new Set<string>()),
		};
		published = [];
		publisher = {
			publish: jest.fn(async (event: DomainEvent<any>) => {
				published.push(event);
			}),
		};
		config = { ...RI_WATCH_DEFAULTS, enabled: true, notifyEnabled: true };
	});

	it('does nothing while notifications are switched off', async () => {
		config.notifyEnabled = false;
		await processed(record());
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result).toEqual({ documents: 0, events: 0, skipped: 0, failed: 0 });
		expect(published).toHaveLength(0);
	});

	it('tells every holder of the issuer, about the class each one holds', async () => {
		const key = await processed(record());
		holdersOf(
			{ userId: 'u1', ticker: 'PETR3' },
			{ userId: 'u2', ticker: 'PETR4' }
		);

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(holders.holdersOfIssuer).toHaveBeenCalledWith('PETR3');
		expect(result).toEqual({ documents: 1, events: 2, skipped: 0, failed: 0 });
		expect(published.map((e) => [e.subject, e.payload.ticker])).toEqual([
			['u1', 'PETR3'],
			['u2', 'PETR4'],
		]);
		expect(published[0]).toMatchObject({
			type: 'ri.material_fact.published',
			producer: 'server.ri-intelligence.watch',
			occurredAt: '2026-09-29T00:00:00.000Z',
			payload: {
				company: 'PETROLEO BRASILEIRO S.A. PETROBRAS',
				title: 'Fato Relevante - Aquisição',
				publishedAt: '2026-09-29T00:00:00.000Z',
				sourceUrl: SOURCE,
			},
		});
		expect(store.docs.get(key)).toMatchObject({
			notifiedAt: NOW.toISOString(),
			notification: { holders: 2, skippedReason: null },
		});
	});

	// Fato relevante sai por e-mail por padrao; o resto nao. O que decide e
	// a categoria OFICIAL, nunca a palavra-chave do titulo.
	it('uses the generic document event for anything but an official material fact', async () => {
		await processed(
			record({
				id: 'x',
				deliveryProtocol: '1571943',
				source: { type: 'url', value: `${SOURCE}3` },
				title: 'Aviso aos Acionistas - Juros sobre Capital Próprio',
				documentType: 'material_fact',
				cvmCategory: 'Aviso aos Acionistas',
			})
		);
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		await makeNotifier().notifyProcessed(NOW);

		expect(published[0].type).toBe('ri.document.published');
	});

	it('sends the AI highlights only to holders whose plan includes them', async () => {
		await processed(record());
		holdersOf(
			{ userId: 'premium', ticker: 'PETR4' },
			{ userId: 'free', ticker: 'PETR4' }
		);
		entitlement.usersWithAiSummary.mockResolvedValue(new Set(['premium']));

		await makeNotifier().notifyProcessed(NOW);

		expect(entitlement.usersWithAiSummary).toHaveBeenCalledWith([
			'premium',
			'free',
		]);
		const bySubject = Object.fromEntries(
			published.map((e) => [e.subject, e.payload])
		);
		expect(bySubject.premium.highlights).toEqual(HIGHLIGHTS.slice(0, 3));
		expect(bySubject.free).not.toHaveProperty('highlights');
	});

	// PDF escaneado, texto curto, IA esgotada: o aviso sai sem resumo.
	it('still notifies a document that could not be summarized', async () => {
		await processed(record(), 'skipped');
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result.events).toBe(1);
		expect(published[0].payload).not.toHaveProperty('highlights');
		expect(entitlement.usersWithAiSummary).not.toHaveBeenCalled();
	});

	it('does not notify a document discovered in this round before its summary', async () => {
		await store.registerNew([record()], NOW);
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result.documents).toBe(0);
		expect(published).toHaveLength(0);
	});

	// Temporada de balancos: o teto de resumos por rodada deixa documento na
	// fila. O aviso espera uma rodada, nao mais — sai sem os destaques.
	it('notifies without highlights a document that waited more than a round', async () => {
		const fiveHoursAgo = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
		const key = watchDocumentKey(record())!;
		await store.registerNew([record()], fiveHoursAgo);
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result.events).toBe(1);
		expect(published[0].payload).not.toHaveProperty('highlights');
		expect(store.docs.get(key)?.status).toBe('pending');
		expect(store.docs.get(key)?.notifiedAt).toBe(NOW.toISOString());
	});

	it('falls back to the ticker when the company name is missing', async () => {
		await processed(record({ company: '  ' }));
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		await makeNotifier().notifyProcessed(NOW);

		expect(published[0].payload.company).toBe('PETR4');
	});

	// Ligar o vigia registra 10 dias de documentos: sem o corte, a primeira
	// rodada mandaria todos os avisos de uma vez.
	it('closes documents older than the max age without notifying', async () => {
		const key = await processed(
			record({ publishedAt: '2026-09-25T00:00:00.000Z' })
		);
		holdersOf({ userId: 'u1', ticker: 'PETR4' });

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result).toEqual({ documents: 1, events: 0, skipped: 1, failed: 0 });
		expect(holders.holdersOfIssuer).not.toHaveBeenCalled();
		expect(store.docs.get(key)?.notification).toEqual({
			holders: 0,
			skippedReason: 'too_old',
		});
	});

	it('closes a document nobody holds anymore', async () => {
		const key = await processed(record());

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result.skipped).toBe(1);
		expect(store.docs.get(key)?.notification).toEqual({
			holders: 0,
			skippedReason: 'no_holders',
		});
	});

	// Reentrega, falha no meio, duas instancias: o mesmo documento e o mesmo
	// usuario geram sempre o mesmo id, e o dedupe da fila e do
	// NotificationsService engole a repeticao.
	it('derives the same event id for the same holder and document', async () => {
		const rec = record();
		await processed(rec);
		holdersOf({ userId: 'u1', ticker: 'PETR4' });
		await makeNotifier().notifyProcessed(NOW);

		const again = new InMemoryRiWatchStore();
		store = again;
		await processed(rec);
		await makeNotifier().notifyProcessed(NOW);

		expect(published).toHaveLength(2);
		expect(published[0].id).toBe(published[1].id);
		expect(published[0].id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});

	it('does not notify the same document twice', async () => {
		await processed(record());
		holdersOf({ userId: 'u1', ticker: 'PETR4' });
		const notifier = makeNotifier();

		await notifier.notifyProcessed(NOW);
		await notifier.notifyProcessed(NOW);

		expect(published).toHaveLength(1);
	});

	it('keeps a failed document in the queue without stopping the others', async () => {
		const failing = await processed(record());
		const ok = await processed(
			record({
				id: 'y',
				deliveryProtocol: '1571950',
				source: { type: 'url', value: `${SOURCE}0` },
				publishedAt: '2026-09-28T00:00:00.000Z',
			})
		);
		holders.holdersOfIssuer
			.mockRejectedValueOnce(new Error('mongo fora'))
			.mockResolvedValueOnce([{ userId: 'u1', ticker: 'PETR4' }]);

		const result = await makeNotifier().notifyProcessed(NOW);

		expect(result).toEqual({ documents: 1, events: 1, skipped: 0, failed: 1 });
		expect(store.docs.get(failing)?.notifiedAt).toBeNull();
		expect(store.docs.get(ok)?.notifiedAt).toBe(NOW.toISOString());
	});
});
