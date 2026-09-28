import { Model } from 'mongoose';
import { MongoRiSummaryCacheAdapter } from 'src/ri-intelligence/infrastructure/mongo-ri-summary-cache.adapter';
import { RiSummaryCacheDocument } from 'src/ri-intelligence/infrastructure/ri-summary-cache.model';

describe('MongoRiSummaryCacheAdapter (TRA-238)', () => {
	let findOneLean: jest.Mock;
	let model: { findOne: jest.Mock; updateOne: jest.Mock };
	let adapter: MongoRiSummaryCacheAdapter<{ narrative: string }>;

	beforeEach(() => {
		findOneLean = jest.fn();
		model = {
			findOne: jest.fn(() => ({ lean: findOneLean })),
			updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
		};
		adapter = new MongoRiSummaryCacheAdapter(
			model as unknown as Model<RiSummaryCacheDocument>
		);
	});

	it('returns the stored value while it has not expired', async () => {
		findOneLean.mockResolvedValue({
			key: 'k',
			value: { narrative: 'ok' },
			expiresAt: new Date(Date.now() + 60_000),
		});

		await expect(adapter.get('k')).resolves.toEqual({ narrative: 'ok' });
		expect(model.findOne).toHaveBeenCalledWith({ key: 'k' });
	});

	it('returns the stored value when it never expires', async () => {
		findOneLean.mockResolvedValue({
			key: 'k',
			value: { narrative: 'ok' },
			expiresAt: null,
		});

		await expect(adapter.get('k')).resolves.toEqual({ narrative: 'ok' });
	});

	// O indice TTL do Mongo apaga em lote a cada ~60s: entre a expiracao e a
	// limpeza o documento ainda existe e nao pode ser servido.
	it('treats an expired entry still on disk as a miss', async () => {
		findOneLean.mockResolvedValue({
			key: 'k',
			value: { narrative: 'velho' },
			expiresAt: new Date(Date.now() - 1_000),
		});

		await expect(adapter.get('k')).resolves.toBeNull();
	});

	it('returns null on a miss', async () => {
		findOneLean.mockResolvedValue(null);

		await expect(adapter.get('k')).resolves.toBeNull();
	});

	it('upserts by key with an absolute expiration', async () => {
		const before = Date.now();

		await adapter.set('k', { narrative: 'novo' }, 3600);

		const [filter, update, options] = model.updateOne.mock.calls[0];
		expect(filter).toEqual({ key: 'k' });
		expect(update.$set.value).toEqual({ narrative: 'novo' });
		const expiresAt = (update.$set.expiresAt as Date).getTime();
		expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
		expect(options).toEqual({ upsert: true });
	});

	it('stores without expiration when ttl is not positive', async () => {
		await adapter.set('k', { narrative: 'novo' });

		const [, update] = model.updateOne.mock.calls[0];
		expect(update.$set.expiresAt).toBeNull();
	});
});
