import { NewTransaction, Transaction } from '../../domain/portfolio.entities';

/**
 * Lote PENDING mais velho que isto é tido como import interrompido (o processo
 * morreu entre reservar o hash e gravar/concluir): claimImport o retoma.
 */
export const STALE_IMPORT_MS = 600_000;

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
	 * Reserva o hash do arquivo para o cliente criando um lote PENDING com
	 * criação em `now`; devolve o importBatchId. Se o hash já tem lote: um
	 * PENDING criado há mais de STALE_IMPORT_MS é descartado (linhas e lote) e o
	 * hash é reservado de novo, com outro id; COMPLETED, ou PENDING mais novo,
	 * lança DuplicateImportError.
	 */
	claimImport(
		orgId: string,
		clientProfileId: string,
		sourceHash: string,
		createdByUserId: string,
		now?: Date
	): Promise<string>;
	/** Marca o lote como COMPLETED; outra org ou cliente não muda nada. */
	completeImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void>;
	/** Desfaz um import que falhou: apaga as transações do lote e libera o hash. */
	discardImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void>;
}
