/**
 * Com `autoIndex: true` o Mongoose dispara `createIndex` de todos os models
 * em paralelo assim que conecta — em produção isso concorre com o boot da
 * API no mesmo host do Mongo (TRA-204). Lá os índices são criados depois,
 * em sequência, pelo `IndexMaintenanceService`.
 */
export function resolveAutoIndex(
	env: NodeJS.ProcessEnv = process.env
): boolean {
	const override = env.MONGO_AUTO_INDEX?.trim().toLowerCase();
	if (override === 'true') return true;
	if (override === 'false') return false;
	return env.NODE_ENV !== 'production';
}

export const DEFAULT_INDEX_BUILD_DELAY_MS = 60_000;

export function resolveIndexBuildDelayMs(
	env: NodeJS.ProcessEnv = process.env
): number {
	const raw = Number(env.MONGO_INDEX_BUILD_DELAY_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INDEX_BUILD_DELAY_MS;
}
