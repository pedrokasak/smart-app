import { Model } from 'mongoose';
import { MongoRiDocumentTextCacheAdapter } from 'src/ri-intelligence/infrastructure/mongo-ri-document-text-cache.adapter';
import { RiDocumentTextDocument } from 'src/ri-intelligence/infrastructure/ri-document-text.model';

describe('MongoRiDocumentTextCacheAdapter (TRA-253)', () => {
	let findOneLean: jest.Mock;
	let model: { findOne: jest.Mock; updateOne: jest.Mock };
	let adapter: MongoRiDocumentTextCacheAdapter;

	beforeEach(() => {
		findOneLean = jest.fn();
		model = {
			findOne: jest.fn(() => ({ lean: findOneLean })),
			updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
		};
		adapter = new MongoRiDocumentTextCacheAdapter(
			model as unknown as Model<RiDocumentTextDocument>
		);
	});

	it('returns the stored text while it has not expired', async () => {
		findOneLean.mockResolvedValue({
			key: 'cvm:1:2:1',
			text: 'texto do pdf',
			expiresAt: new Date(Date.now() + 60_000),
		});

		await expect(adapter.get('cvm:1:2:1')).resolves.toBe('texto do pdf');
		expect(model.findOne).toHaveBeenCalledWith({ key: 'cvm:1:2:1' });
	});

	// O indice TTL apaga em lote; entre expirar e sumir, nao serve.
	it('does not serve an expired text', async () => {
		findOneLean.mockResolvedValue({
			key: 'k',
			text: 'velho',
			expiresAt: new Date(Date.now() - 1_000),
		});

		await expect(adapter.get('k')).resolves.toBeNull();
	});

	it('returns null when there is nothing stored', async () => {
		findOneLean.mockResolvedValue(null);

		await expect(adapter.get('k')).resolves.toBeNull();
	});

	it('upserts the text with its expiration', async () => {
		const before = Date.now();

		await adapter.set('k', 'texto', 3600);

		const [filter, update, options] = model.updateOne.mock.calls[0];
		expect(filter).toEqual({ key: 'k' });
		expect(options).toEqual({ upsert: true });
		expect(update.$set.text).toBe('texto');
		expect(update.$set.expiresAt.getTime()).toBeGreaterThanOrEqual(
			before + 3600 * 1000
		);
	});

	// O Mongo recusa documento acima de 16 MB: texto enorme so nao e guardado.
	it('does not store a text too large for the database', async () => {
		await adapter.set('k', 'x'.repeat(3_000_001), 3600);

		expect(model.updateOne).not.toHaveBeenCalled();
	});
});
