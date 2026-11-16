import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import {
	DuplicateImportError,
	TransactionStorePort,
} from '../application/ports/transaction.store.port';
import { NewTransaction, Transaction } from '../domain/portfolio.entities';
import { toTransaction } from './advisor.mappers';
import {
	ADVISOR_IMPORT_BATCH_MODEL,
	ADVISOR_TRANSACTION_MODEL,
	AdvisorImportBatchDoc,
	AdvisorTransactionDoc,
	IMPORT_BATCH_HASH_INDEX,
} from './advisor-portfolio.models';

const DUPLICATE_KEY = 11000;

/** 11000 só conta se vier do índice único do hash de import. */
function isImportHashDuplicate(error: unknown): boolean {
	const e = error as {
		code?: number;
		message?: string;
		keyPattern?: Record<string, unknown>;
	} | null;
	if (e?.code !== DUPLICATE_KEY) return false;
	return (
		e.keyPattern?.sourceHash !== undefined ||
		(e.message ?? '').includes(IMPORT_BATCH_HASH_INDEX)
	);
}

@Injectable()
export class MongoTransactionStore implements TransactionStorePort {
	private readonly logger = new Logger(MongoTransactionStore.name);

	constructor(
		@InjectModel(ADVISOR_TRANSACTION_MODEL)
		private readonly transactions: Model<AdvisorTransactionDoc>,
		@InjectModel(ADVISOR_IMPORT_BATCH_MODEL)
		private readonly batches: Model<AdvisorImportBatchDoc>
	) {}

	/**
	 * Sem transação Mongo (não se assume replica set): valida tudo antes de
	 * escrever e, se o insert falhar no meio, apaga o que gravou pelos `_id`s
	 * gerados aqui e relança o erro original.
	 */
	async createMany(items: NewTransaction[]): Promise<Transaction[]> {
		if (items.length === 0) return [];
		const createdAt = new Date();
		const docs = items.map(
			(item, seq) =>
				new this.transactions({ ...item, _id: randomUUID(), createdAt, seq })
		);
		for (const doc of docs) {
			const invalid = doc.validateSync();
			if (invalid) throw invalid;
		}
		try {
			await this.transactions.insertMany(docs, { ordered: true });
		} catch (error) {
			try {
				await this.transactions
					.deleteMany({ _id: { $in: docs.map((d) => d._id) } })
					.exec();
			} catch (cleanupError) {
				// O erro original sempre vence; só registramos a falha da limpeza.
				this.logger.error(
					`createMany cleanup failed for ${docs.length} rows: ${
						(cleanupError as Error)?.name ?? 'unknown error'
					}`
				);
			}
			throw error;
		}
		return docs.map((doc) => toTransaction(doc.toObject()));
	}

	async listByClient(
		orgId: string,
		clientProfileId: string
	): Promise<Transaction[]> {
		const docs = await this.transactions
			.find({ orgId, clientProfileId })
			.sort({ tradeDate: 1, createdAt: 1, seq: 1, _id: 1 })
			.lean<AdvisorTransactionDoc[]>()
			.exec();
		return docs.map(toTransaction);
	}

	async findById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<Transaction | null> {
		const doc = await this.transactions
			.findOne({ _id: id, orgId, clientProfileId })
			.lean<AdvisorTransactionDoc>()
			.exec();
		return doc ? toTransaction(doc) : null;
	}

	async deleteById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<boolean> {
		const result = await this.transactions
			.deleteOne({ _id: id, orgId, clientProfileId })
			.exec();
		return result.deletedCount === 1;
	}

	async claimImport(
		orgId: string,
		clientProfileId: string,
		sourceHash: string,
		createdByUserId: string
	): Promise<string> {
		try {
			const batch = await this.batches.create({
				orgId,
				clientProfileId,
				sourceHash,
				createdByUserId,
			});
			return batch._id;
		} catch (error) {
			if (isImportHashDuplicate(error)) throw new DuplicateImportError();
			throw error;
		}
	}

	async discardImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void> {
		await this.transactions
			.deleteMany({ orgId, clientProfileId, importBatchId })
			.exec();
		await this.batches
			.deleteOne({ _id: importBatchId, orgId, clientProfileId })
			.exec();
	}
}
