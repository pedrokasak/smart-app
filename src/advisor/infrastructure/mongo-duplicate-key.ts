const DUPLICATE_KEY = 11000;

interface MongoDuplicateKeyError {
	code?: number;
	message?: string;
	keyPattern?: Record<string, unknown>;
}

/**
 * Chave duplicada (E11000) vinda de um índice específico: confere o nome do
 * índice na mensagem ou os campos do `keyPattern`. Qualquer outro E11000
 * (outro índice, `_id`) não conta e deve ser relançado pelo chamador.
 */
export function isDuplicateOnIndex(
	error: unknown,
	indexName: string,
	keyFields: string[]
): boolean {
	const e = error as MongoDuplicateKeyError | null;
	if (e?.code !== DUPLICATE_KEY) return false;
	if ((e.message ?? '').includes(indexName)) return true;
	const pattern = e.keyPattern;
	if (!pattern) return false;
	const keys = Object.keys(pattern);
	return (
		keys.length === keyFields.length && keyFields.every((f) => f in pattern)
	);
}

/** Qualquer E11000, sem olhar o índice. */
export const isDuplicateKey = (error: unknown): boolean =>
	(error as { code?: number } | null)?.code === DUPLICATE_KEY;

/**
 * Upsert contra um índice único: dois primeiros upserts concorrentes batem
 * no índice; o perdedor repete uma vez e cai no caminho de update.
 */
export async function retryOnDuplicateKey<T>(
	run: () => Promise<T>
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (!isDuplicateKey(error)) throw error;
		return run();
	}
}
