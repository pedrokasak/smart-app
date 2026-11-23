import { SnapshotSource } from '../../domain/enums';

export interface WealthDailyRow {
	orgId: string;
	clientProfileId: string;
	/** YYYY-MM-DD. */
	date: string;
	source: SnapshotSource;
	/** Só na carteira compartilhada; o livro do assessor não tem. */
	portfolioId?: string;
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
}

export interface WealthDailySum {
	date: string;
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
	/** Clientes distintos com linha naquele dia. */
	clients: number;
}

export interface WealthDailyStorePort {
	/**
	 * Uma linha por (orgId, clientProfileId, date, source, portfolioId); o
	 * último valor vence. A linha expira 400 dias depois de criada.
	 */
	upsert(row: WealthDailyRow): Promise<void>;
	/**
	 * Apaga as linhas da fonte. Com `portfolioId`, só as dessa carteira; sem
	 * ele, todas as da fonte.
	 */
	deleteSource(
		orgId: string,
		clientProfileId: string,
		source: SnapshotSource,
		portfolioId?: string
	): Promise<void>;
	deleteClient(orgId: string, clientProfileId: string): Promise<void>;
	/**
	 * Soma por dia, de `from` a `to` (YYYY-MM-DD, inclusivos), crescente.
	 * Com `clientIds`, só esses clientes (lista vazia => nenhum).
	 */
	sumByDate(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<WealthDailySum[]>;
	/** Clientes com ao menos uma linha naquele dia. */
	clientIdsOn(
		orgId: string,
		date: string,
		clientIds?: string[]
	): Promise<string[]>;
}
