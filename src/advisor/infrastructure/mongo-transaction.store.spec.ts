import { Logger } from '@nestjs/common';
import mongoose, { Model } from 'mongoose';
import {
	DuplicateImportError,
	STALE_IMPORT_MS,
} from '../application/ports/transaction.store.port';
import {
	AssetClass,
	ImportBatchStatus,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';
import { NewTransaction } from '../domain/portfolio.entities';
import {
	advisorPortfolioSchemas,
	AdvisorImportBatchDoc,
	AdvisorTransactionDoc,
} from './advisor-portfolio.models';
import { MongoTransactionStore } from './mongo-transaction.store';

/**
 * Sem banco: modelos reais do mongoose (nunca conectados) com `insertMany` e
 * `deleteMany` espionados, para exercitar o caminho de compensação.
 */
const tx = (symbol: string, overrides: Partial<NewTransaction> = {}) =>
	({
		orgId: 'o',
		clientProfileId: 'c',
		symbol,
		assetClass: AssetClass.Stock,
		side: TransactionSide.Buy,
		quantity: 1,
		unitPriceMinor: 100,
		feesMinor: 0,
		currency: 'BRL',
		tradeDate: '2026-01-10',
		provenance: Provenance.Manual,
		source: TransactionSource.ManualEntry,
		createdByUserId: 'u1',
		...overrides,
	}) as NewTransaction;

describe('MongoTransactionStore.createMany compensation', () => {
	let transactions: Model<AdvisorTransactionDoc>;
	let store: MongoTransactionStore;
	let insertMany: jest.SpyInstance;
	let deleteMany: jest.SpyInstance;
	let exec: jest.Mock;

	beforeEach(() => {
		const suffix = Math.random().toString(36).slice(2);
		transactions = mongoose.model<AdvisorTransactionDoc>(
			`AdvisorTransactionStoreSpec${suffix}`,
			advisorPortfolioSchemas.transaction
		);
		const batches = mongoose.model<AdvisorImportBatchDoc>(
			`AdvisorImportBatchStoreSpec${suffix}`,
			advisorPortfolioSchemas.importBatch
		);
		exec = jest.fn().mockResolvedValue({ deletedCount: 0 });
		insertMany = jest.spyOn(transactions, 'insertMany');
		deleteMany = jest
			.spyOn(transactions, 'deleteMany')
			.mockReturnValue({ exec } as never);
		store = new MongoTransactionStore(transactions, batches);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('deletes exactly the generated ids and rethrows the original error when insertMany fails', async () => {
		const failure = new Error('write failed midway');
		insertMany.mockRejectedValue(failure);

		await expect(store.createMany([tx('A'), tx('B'), tx('C')])).rejects.toBe(
			failure
		);

		const inserted = (insertMany.mock.calls[0][0] as { _id: string }[]).map(
			(d) => d._id
		);
		expect(inserted).toHaveLength(3);
		expect(new Set(inserted).size).toBe(3);
		expect(deleteMany).toHaveBeenCalledTimes(1);
		expect(deleteMany).toHaveBeenCalledWith({ _id: { $in: inserted } });
	});

	it('writes nothing when one document fails validation', async () => {
		await expect(
			store.createMany([tx('A'), tx('B', { unitPriceMinor: 10.5 })])
		).rejects.toThrow();

		expect(insertMany).not.toHaveBeenCalled();
		expect(deleteMany).not.toHaveBeenCalled();
	});

	it('still rejects with the original error when the cleanup also fails', async () => {
		const failure = new Error('write failed midway');
		insertMany.mockRejectedValue(failure);
		exec.mockRejectedValue(new Error('cleanup failed'));

		await expect(store.createMany([tx('A')])).rejects.toBe(failure);
		expect(deleteMany).toHaveBeenCalledTimes(1);
	});

	it('returns [] for empty input without touching the database', async () => {
		await expect(store.createMany([])).resolves.toEqual([]);
		expect(insertMany).not.toHaveBeenCalled();
		expect(deleteMany).not.toHaveBeenCalled();
	});
});

describe('MongoTransactionStore import batches', () => {
	const NOW = new Date('2026-11-16T12:00:00.000Z');
	const duplicateKey = Object.assign(new Error('E11000'), {
		code: 11000,
		keyPattern: { orgId: 1, clientProfileId: 1, sourceHash: 1 },
	});
	let batches: Model<AdvisorImportBatchDoc>;
	let store: MongoTransactionStore;
	let create: jest.SpyInstance;
	let findOne: jest.SpyInstance;
	let deleteOne: jest.SpyInstance;
	let deleteManyRows: jest.SpyInstance;
	let updateOne: jest.SpyInstance;
	let staleBatch: { _id: string } | null;
	let batchDeleted: number;

	beforeEach(() => {
		const suffix = Math.random().toString(36).slice(2);
		const transactions = mongoose.model<AdvisorTransactionDoc>(
			`AdvisorTransactionBatchSpec${suffix}`,
			advisorPortfolioSchemas.transaction
		);
		batches = mongoose.model<AdvisorImportBatchDoc>(
			`AdvisorImportBatchBatchSpec${suffix}`,
			advisorPortfolioSchemas.importBatch
		);
		staleBatch = null;
		batchDeleted = 1;
		create = jest.spyOn(batches, 'create');
		findOne = jest.spyOn(batches, 'findOne').mockImplementation(
			() =>
				({
					lean: () => ({ exec: async () => staleBatch }),
				}) as never
		);
		deleteOne = jest
			.spyOn(batches, 'deleteOne')
			.mockImplementation(
				() => ({ exec: async () => ({ deletedCount: batchDeleted }) }) as never
			);
		updateOne = jest
			.spyOn(batches, 'updateOne')
			.mockImplementation(
				() => ({ exec: async () => ({ modifiedCount: 1 }) }) as never
			);
		deleteManyRows = jest
			.spyOn(transactions, 'deleteMany')
			.mockImplementation(
				() => ({ exec: async () => ({ deletedCount: 2 }) }) as never
			);
		store = new MongoTransactionStore(transactions, batches);
	});

	afterEach(() => jest.restoreAllMocks());

	it('claims a PENDING batch created at the given now', async () => {
		create.mockResolvedValue({ _id: 'b1' } as never);

		await expect(store.claimImport('o', 'c', 'h', 'u1', NOW)).resolves.toBe(
			'b1'
		);
		expect(create).toHaveBeenCalledWith({
			orgId: 'o',
			clientProfileId: 'c',
			sourceHash: 'h',
			createdByUserId: 'u1',
			status: ImportBatchStatus.Pending,
			createdAt: NOW,
		});
	});

	it('looks only for a PENDING batch older than the stale window and rejects when there is none', async () => {
		create.mockRejectedValue(duplicateKey);

		await expect(
			store.claimImport('o', 'c', 'h', 'u1', NOW)
		).rejects.toBeInstanceOf(DuplicateImportError);
		expect(findOne).toHaveBeenCalledWith({
			orgId: 'o',
			clientProfileId: 'c',
			sourceHash: 'h',
			status: ImportBatchStatus.Pending,
			createdAt: { $lt: new Date(NOW.getTime() - STALE_IMPORT_MS) },
		});
		expect(deleteManyRows).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('takes over a stale batch: removes its rows, then the batch, then claims again', async () => {
		staleBatch = { _id: 'old' };
		create
			.mockRejectedValueOnce(duplicateKey)
			.mockResolvedValueOnce({ _id: 'new' } as never);

		await expect(store.claimImport('o', 'c', 'h', 'u1', NOW)).resolves.toBe(
			'new'
		);
		expect(deleteManyRows).toHaveBeenCalledWith({
			orgId: 'o',
			clientProfileId: 'c',
			importBatchId: 'old',
		});
		expect(deleteOne).toHaveBeenCalledWith({
			_id: 'old',
			orgId: 'o',
			clientProfileId: 'c',
			status: ImportBatchStatus.Pending,
		});
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('is a duplicate when another caller removed the stale batch first', async () => {
		staleBatch = { _id: 'old' };
		batchDeleted = 0;
		create.mockRejectedValue(duplicateKey);

		await expect(
			store.claimImport('o', 'c', 'h', 'u1', NOW)
		).rejects.toBeInstanceOf(DuplicateImportError);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('completeImport sets COMPLETED scoped to org and client', async () => {
		await store.completeImport('o', 'c', 'b1');

		expect(updateOne).toHaveBeenCalledWith(
			{ _id: 'b1', orgId: 'o', clientProfileId: 'c' },
			{ $set: { status: ImportBatchStatus.Completed } }
		);
	});
});
