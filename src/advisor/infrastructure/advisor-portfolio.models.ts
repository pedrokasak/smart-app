import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';
import {
	AssetClass,
	ImportBatchStatus,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';

/**
 * Coleções de carteira do módulo advisor. Mesmas regras do restante: `_id`
 * string (uuid), sem `ref` para coleções de outros módulos.
 */
export const ADVISOR_TRANSACTION_MODEL = 'AdvisorTransaction';
export const ADVISOR_IMPORT_BATCH_MODEL = 'AdvisorImportBatch';
export const ADVISOR_ALLOCATION_TARGET_MODEL = 'AdvisorAllocationTarget';

/** Nome do índice único que protege o hash de import (conferido no erro 11000). */
export const IMPORT_BATCH_HASH_INDEX = 'advisor_import_batch_hash_unique';

interface TimestampedDoc {
	_id: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorTransactionDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	symbol: string;
	assetClass: AssetClass;
	side: TransactionSide;
	quantity: number;
	unitPriceMinor: number;
	feesMinor: number;
	currency: string;
	tradeDate: string;
	liquidityDays?: number | null;
	provenance: Provenance;
	source: TransactionSource;
	importBatchId?: string | null;
	createdByUserId: string;
	/** Posição da linha dentro do createMany: desempate estável na listagem. */
	seq: number;
}

export interface AdvisorImportBatchDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	sourceHash: string;
	createdByUserId: string;
	/** PENDING da reserva do hash até as linhas gravarem; então COMPLETED. */
	status: ImportBatchStatus;
}

export interface AdvisorAllocationTargetDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	targets: Partial<Record<AssetClass, number>>;
	updatedByUserId: string;
}

const id = {
	type: String,
	default: (): string => randomUUID(),
};

const baseOptions = { versionKey: false, timestamps: true } as const;

const isInteger = {
	validator: (value: number): boolean => Number.isInteger(value),
	message: '{PATH} must be an integer',
};

const transactionSchema = new Schema<AdvisorTransactionDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		symbol: { type: String, required: true },
		assetClass: {
			type: String,
			enum: Object.values(AssetClass),
			required: true,
		},
		side: {
			type: String,
			enum: Object.values(TransactionSide),
			required: true,
		},
		quantity: {
			type: Number,
			required: true,
			validate: {
				validator: (value: number): boolean =>
					Number.isFinite(value) && value > 0,
				message: 'quantity must be greater than zero',
			},
		},
		unitPriceMinor: {
			type: Number,
			required: true,
			min: 0,
			validate: isInteger,
		},
		feesMinor: { type: Number, required: true, min: 0, validate: isInteger },
		currency: { type: String, required: true },
		tradeDate: {
			type: String,
			required: true,
			match: /^\d{4}-\d{2}-\d{2}$/,
		},
		liquidityDays: { type: Number, min: 0, validate: isInteger },
		provenance: {
			type: String,
			enum: Object.values(Provenance),
			required: true,
		},
		source: {
			type: String,
			enum: Object.values(TransactionSource),
			required: true,
		},
		importBatchId: { type: String },
		createdByUserId: { type: String, required: true },
		seq: { type: Number, required: true, default: 0, validate: isInteger },
	},
	{ ...baseOptions, collection: 'advisor_transactions' }
);
// Listagem do livro-razão por cliente (tradeDate, createdAt).
transactionSchema.index(
	{ orgId: 1, clientProfileId: 1, tradeDate: 1, createdAt: 1 },
	{ name: 'advisor_transaction_ledger_order' }
);
// Desfazer um import e localizar as linhas de um lote.
transactionSchema.index(
	{ orgId: 1, clientProfileId: 1, importBatchId: 1 },
	{ name: 'advisor_transaction_import_batch' }
);

const importBatchSchema = new Schema<AdvisorImportBatchDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		sourceHash: { type: String, required: true },
		createdByUserId: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(ImportBatchStatus),
			required: true,
			default: ImportBatchStatus.Pending,
		},
	},
	{ ...baseOptions, collection: 'advisor_import_batches' }
);
// O mesmo arquivo (hash) só pode ser importado uma vez por cliente.
importBatchSchema.index(
	{ orgId: 1, clientProfileId: 1, sourceHash: 1 },
	{ unique: true, name: IMPORT_BATCH_HASH_INDEX }
);

const allocationTargetSchema = new Schema<AdvisorAllocationTargetDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		targets: {
			type: Schema.Types.Mixed,
			required: true,
			validate: {
				validator: (value: unknown): boolean => {
					if (value === null || typeof value !== 'object') return false;
					const classes = Object.values(AssetClass) as string[];
					return Object.entries(value).every(
						([key, pct]) =>
							classes.includes(key) &&
							typeof pct === 'number' &&
							Number.isFinite(pct) &&
							pct >= 0
					);
				},
				message: 'targets must map asset classes to non-negative numbers',
			},
		},
		updatedByUserId: { type: String, required: true },
	},
	{ ...baseOptions, minimize: false, collection: 'advisor_allocation_targets' }
);
allocationTargetSchema.index(
	{ orgId: 1, clientProfileId: 1 },
	{ unique: true, name: 'advisor_allocation_target_client_unique' }
);

export const advisorPortfolioSchemas = {
	transaction: transactionSchema,
	importBatch: importBatchSchema,
	allocationTarget: allocationTargetSchema,
};
