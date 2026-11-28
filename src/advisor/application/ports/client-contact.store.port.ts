export interface ClientContactStorePort {
	/** Guarda só o contato mais recente; um `at` mais antigo é ignorado. */
	record(
		orgId: string,
		clientProfileId: string,
		at: Date,
		userId: string
	): Promise<void>;
	find(orgId: string, clientProfileId: string): Promise<Date | null>;
	deleteByClient(orgId: string, clientProfileId: string): Promise<void>;
}
