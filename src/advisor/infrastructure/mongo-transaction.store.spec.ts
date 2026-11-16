import { Logger } from '@nestjs/common';
import mongoose, { Model } from 'mongoose';
import {
	AssetClass,
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
