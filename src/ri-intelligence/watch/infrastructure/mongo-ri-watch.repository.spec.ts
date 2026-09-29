import { Model } from 'mongoose';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import {
	RI_WATCH_MAX_ATTEMPTS,
	watchDocumentKey,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import { MongoRiWatchRepository } from 'src/ri-intelligence/watch/infrastructure/mongo-ri-watch.repository';
import { RiWatchDocumentSchema } from 'src/ri-intelligence/watch/infrastructure/ri-watch-document.model';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function record(link: string): RiDocumentRecord {
	return {
		id: `PETR4:material_fact:${link}:cvm`,
		ticker: 'PETR4',
		company: 'Petrobras',
		title: 'Fato Relevante',
		documentType: 'material_fact',
		period: null,
		publishedAt: '2026-09-27T00:00:00.000Z',
		source: { type: 'url', value: link },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
	};
}

describe('MongoRiWatchRepository (TRA-240)', () => {
	let model: {
		bulkWrite: jest.Mock;
		find: jest.Mock;
		updateOne: jest.Mock;
	};
	let chain: { sort: jest.Mock; limit: jest.Mock; lean: jest.Mock };
	let repo: MongoRiWatchRepository;

	beforeEach(() => {
		chain = {
			sort: jest.fn().mockReturnThis(),
			limit: jest.fn().mockReturnThis(),
			lean: jest.fn().mockResolvedValue([]),
		};
		model = {
			bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
			find: jest.fn(() => chain),
			updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
		};
		repo = new MongoRiWatchRepository(
			model as unknown as Model<RiWatchDocumentSchema>
		);
	});

	it('registers with insert-only upserts and reports what was new', async () => {
		const inserted = await repo.registerNew(
			[
				record('https://rad/a'),
				record('https://rad/a'),
				record('https://rad/b'),
			],
			NOW
		);

		expect(inserted).toBe(1);
		const [ops, options] = model.bulkWrite.mock.calls[0];
		// Mesmo link duas vezes no lote vira uma operacao so.
		expect(ops).toHaveLength(2);
		expect(options).toEqual({ ordered: false });
		const [first] = ops;
		expect(first.updateOne.filter).toEqual({
			key: watchDocumentKey(record('https://rad/a')),
		});
		expect(first.updateOne.upsert).toBe(true);
		// $setOnInsert: documento ja conhecido nao volta a pendente.
		expect(first.updateOne.update.$setOnInsert).toMatchObject({
			status: 'pending',
			attempts: 0,
			ticker: 'PETR4',
			publishedAt: new Date('2026-09-27T00:00:00.000Z'),
			discoveredAt: NOW,
		});
		expect(first.updateOne.update.$set).toBeUndefined();
	});

	it('does not touch the database for an empty batch', async () => {
		expect(await repo.registerNew([], NOW)).toBe(0);
		expect(model.bulkWrite).not.toHaveBeenCalled();
	});

	it('lists pending documents under the attempt cap, newest first', async () => {
		chain.lean.mockResolvedValue([
			{
				key: 'k1',
				ticker: 'PETR4',
				documentType: 'material_fact',
				publishedAt: new Date('2026-09-27T00:00:00.000Z'),
				record: record('https://rad/a'),
				status: 'pending',
				attempts: 1,
				discoveredAt: NOW,
				processedAt: null,
				lastError: 'content_fetch_failed',
				summary: null,
			},
		]);

		const pending = await repo.findPending(5);

		expect(model.find).toHaveBeenCalledWith({
			status: 'pending',
			attempts: { $lt: RI_WATCH_MAX_ATTEMPTS },
		});
		expect(chain.sort).toHaveBeenCalledWith({ publishedAt: -1 });
		expect(chain.limit).toHaveBeenCalledWith(5);
		expect(pending[0]).toMatchObject({
			key: 'k1',
			publishedAt: '2026-09-27T00:00:00.000Z',
			discoveredAt: NOW.toISOString(),
			attempts: 1,
		});
	});

	it('counts a failure and retires the document at the cap', async () => {
		await repo.recordFailure('k1', 'content_fetch_failed', NOW);

		const [[incFilter, inc], [capFilter, cap]] = model.updateOne.mock.calls;
		expect(incFilter).toEqual({ key: 'k1' });
		expect(inc).toEqual({
			$inc: { attempts: 1 },
			$set: { lastError: 'content_fetch_failed', processedAt: NOW },
		});
		expect(capFilter).toEqual({
			key: 'k1',
			status: 'pending',
			attempts: { $gte: RI_WATCH_MAX_ATTEMPTS },
		});
		expect(cap).toEqual({ $set: { status: 'failed' } });
	});

	it('stores the summary snapshot when summarized', async () => {
		const summary = { highlights: ['x'], citations: [] };

		await repo.markSummarized('k1', summary, NOW);

		expect(model.updateOne).toHaveBeenCalledWith(
			{ key: 'k1' },
			{
				$set: {
					status: 'summarized',
					summary,
					processedAt: NOW,
					lastError: null,
				},
			}
		);
	});

	it('records why a document was skipped', async () => {
		await repo.markSkipped('k1', 'no_longer_held', NOW);

		expect(model.updateOne).toHaveBeenCalledWith(
			{ key: 'k1' },
			{
				$set: {
					status: 'skipped',
					lastError: 'no_longer_held',
					processedAt: NOW,
				},
			}
		);
	});

	// TRA-261: a fila de aviso. `notifiedAt: null` casa tambem o campo
	// ausente dos documentos registrados antes desta etapa.
	it('lists documents nobody was told about, newest first', async () => {
		chain.lean.mockResolvedValue([
			{
				key: 'k1',
				ticker: 'PETR4',
				documentType: 'material_fact',
				publishedAt: new Date('2026-09-27T00:00:00.000Z'),
				record: record('https://rad/a'),
				status: 'summarized',
				attempts: 0,
				discoveredAt: NOW,
				processedAt: NOW,
				lastError: null,
				summary: { highlights: ['x'], citations: [] },
			},
		]);

		const since = new Date('2026-09-28T08:00:00.000Z');
		const unnotified = await repo.findUnnotified(50, since);

		// Terminados, ou esperando o resumo desde antes de `since`.
		expect(model.find).toHaveBeenCalledWith({
			notifiedAt: null,
			$or: [
				{ status: { $in: ['summarized', 'skipped', 'failed'] } },
				{ status: 'pending', discoveredAt: { $lte: since } },
			],
		});
		expect(chain.sort).toHaveBeenCalledWith({ publishedAt: -1 });
		expect(chain.limit).toHaveBeenCalledWith(50);
		expect(unnotified[0]).toMatchObject({
			key: 'k1',
			notifiedAt: null,
			notification: null,
		});
	});

	it('closes the notification with how it ended', async () => {
		const notification = { holders: 12, skippedReason: null };

		await repo.markNotified('k1', notification, NOW);

		expect(model.updateOne).toHaveBeenCalledWith(
			{ key: 'k1' },
			{ $set: { notifiedAt: NOW, notification } }
		);
	});

	// TRA-264: a fila do acervo. `indexedAt: null` casa o campo ausente: o
	// que foi processado antes do acervo entra nela.
	it('lists finished documents still out of the knowledge base', async () => {
		await repo.findUnindexed(20);

		expect(model.find).toHaveBeenCalledWith({
			status: { $in: ['summarized', 'skipped', 'failed'] },
			indexedAt: null,
		});
		expect(chain.sort).toHaveBeenCalledWith({ publishedAt: -1 });
		expect(chain.limit).toHaveBeenCalledWith(20);
	});

	it('closes the index queue for a document', async () => {
		await repo.markIndexed('k1', NOW);

		expect(model.updateOne).toHaveBeenCalledWith(
			{ key: 'k1' },
			{ $set: { indexedAt: NOW } }
		);
	});

	it('registers new documents as not notified yet', async () => {
		await repo.registerNew([record('https://rad/a')], NOW);

		const [[op]] = model.bulkWrite.mock.calls[0];
		expect(op.updateOne.update.$setOnInsert).toMatchObject({
			notifiedAt: null,
			notification: null,
			indexedAt: null,
		});
	});
});
