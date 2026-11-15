import { NewTransaction, Transaction } from '../../domain/portfolio.entities';

/** Lançado por claimImport quando o hash do arquivo já foi importado. */
export class DuplicateImportError extends Error {
	constructor() {
		super('Import already claimed for this client');
		this.name = 'DuplicateImportError';
	}
}

export interface TransactionStorePort {
	/** Grava todas ou nenhuma. O store gera id e createdAt. */
	createMany(items: NewTransaction[]): Promise<Transaction[]>;
	/** Ordenado por tradeDate, depois createdAt. */
	listByClient(orgId: string, clientProfileId: string): Promise<Transaction[]>;
	findById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<Transaction | null>;
	deleteById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<boolean>;
	/**
	 * Reserva o hash do arquivo para o cliente; lança DuplicateImportError se já
	 * existe. Devolve o importBatchId.
	 */
	claimImport(
		orgId: string,
		clientProfileId: string,
		sourceHash: string,
		createdByUserId: string
	): Promise<string>;
	/** Desfaz um import que falhou: apaga as transações do lote e libera o hash. */
	discardImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void>;
}
