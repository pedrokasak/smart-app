import {
	countUsers,
	daysAgo,
	UserCountFilter,
	UserCounter,
} from './user-activity-metrics';

/**
 * Coleção falsa que avalia o filtro de verdade (só `$gte` em data, que é tudo
 * que a porta aceita). Assim o teste prova a JANELA usada em cada contagem, e
 * não apenas que `countDocuments` foi chamado.
 */
function fakeUsers(
	docs: Array<{ createdAt: Date; lastSeenAt?: Date }>
): UserCounter & { filters: Array<UserCountFilter | undefined> } {
	const filters: Array<UserCountFilter | undefined> = [];
	return {
		filters,
		countDocuments(filter?: UserCountFilter) {
			filters.push(filter);
			const matches = docs.filter((doc) =>
				Object.entries(filter ?? {}).every(([field, condition]) => {
					const value = doc[field as keyof typeof doc];
					return value instanceof Date && value >= condition.$gte;
				})
			);
			return { exec: async () => matches.length };
		},
	};
}

describe('countUsers (TRA-192)', () => {
	const now = new Date('2026-09-24T12:00:00.000Z');
	const hoursAgo = (hours: number) =>
		new Date(now.getTime() - hours * 60 * 60 * 1000);

	it('separa contas novas e usuários ativos por janela', async () => {
		const users = fakeUsers([
			// criada hoje, ativa agora
			{ createdAt: hoursAgo(2), lastSeenAt: hoursAgo(1) },
			// criada há 10 dias, ativa há 3 dias
			{ createdAt: daysAgo(now, 10), lastSeenAt: daysAgo(now, 3) },
			// criada há 60 dias, ativa há 20 dias
			{ createdAt: daysAgo(now, 60), lastSeenAt: daysAgo(now, 20) },
			// antiga e nunca vista desde que o campo existe
			{ createdAt: daysAgo(now, 400) },
		]);

		await expect(countUsers(users, now)).resolves.toEqual({
			total: 4,
			newLast7Days: 1,
			newLast30Days: 2,
			activeLast24h: 1,
			activeLast7Days: 2,
			activeLast30Days: 3,
		});
	});

	it('conta usuário sem lastSeenAt como inativo, nunca como erro', async () => {
		const users = fakeUsers([{ createdAt: daysAgo(now, 1) }]);

		const result = await countUsers(users, now);

		expect(result.total).toBe(1);
		expect(result.activeLast24h).toBe(0);
		expect(result.activeLast30Days).toBe(0);
	});

	it('limite da janela é inclusivo (exatamente 7 dias atrás conta)', async () => {
		const users = fakeUsers([
			{ createdAt: daysAgo(now, 7), lastSeenAt: daysAgo(now, 7) },
		]);

		const result = await countUsers(users, now);

		expect(result.newLast7Days).toBe(1);
		expect(result.activeLast7Days).toBe(1);
	});

	it('filtra só por datas — nenhum filtro toca campo de dado pessoal', async () => {
		const users = fakeUsers([]);

		await countUsers(users, now);

		const fields = users.filters.flatMap((filter) => Object.keys(filter ?? {}));
		expect(new Set(fields)).toEqual(new Set(['createdAt', 'lastSeenAt']));
	});

	it('devolve apenas as seis contagens, sem nenhum campo extra', async () => {
		const result = await countUsers(fakeUsers([]), now);

		expect(Object.keys(result).sort()).toEqual(
			[
				'activeLast24h',
				'activeLast30Days',
				'activeLast7Days',
				'newLast30Days',
				'newLast7Days',
				'total',
			].sort()
		);
		Object.values(result).forEach((value) =>
			expect(typeof value).toBe('number')
		);
	});
});
