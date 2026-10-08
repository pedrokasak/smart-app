/**
 * Dublê de `PlanQuotaService` para specs que não testam cota: tudo liberado,
 * `createWithinQuota` só executa a criação.
 */
export const unlimitedPlanQuota = {
	limitFor: async () => null,
	assertCanAdd: async () => undefined,
	createWithinQuota: async (
		_userId: string,
		_resource: string,
		create: () => Promise<unknown>
	) => create(),
	usageFor: async () => [],
};
