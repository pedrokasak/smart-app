/**
 * Contagem agregada de usuários para o painel admin (TRA-192).
 *
 * Só números. O painel não precisa — e pela política de privacidade não pode —
 * saber QUEM são os usuários para responder "quantos existem" e "quantos estão
 * usando". Por isso a porta abaixo só expõe `count`: não existe método que
 * devolva documento, então nenhuma evolução futura deste painel consegue vazar
 * nome ou e-mail por acidente.
 */
export type UserCountsMetric = {
	/** Contas criadas desde sempre. */
	total: number;
	newLast7Days: number;
	newLast30Days: number;
	/** Usuários com login ou renovação de sessão nas últimas 24 h. */
	activeLast24h: number;
	activeLast7Days: number;
	activeLast30Days: number;
};

/** Filtro de contagem aceito pela porta — só campos de data, nunca PII. */
export type UserCountFilter = {
	createdAt?: { $gte: Date };
	lastSeenAt?: { $gte: Date };
};

/**
 * Porta mínima sobre a coleção de usuários. `Model<User>` do Mongoose já a
 * satisfaz, mas declarar o contrato aqui deixa explícito que esta rotina só
 * CONTA — e permite testar sem banco.
 */
export interface UserCounter {
	countDocuments(filter?: UserCountFilter): { exec(): Promise<number> };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysAgo(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/**
 * As seis contagens rodam em paralelo; cada uma usa índice (`createdAt` e
 * `lastSeenAt` são indexados), então o custo não cresce com o tamanho dos
 * documentos.
 *
 * "Ativo" usa `lastSeenAt`, que é gravado no login e na renovação de sessão.
 * Usuários que não entraram desde que o campo passou a existir contam como
 * inativos até o próximo acesso — o painel avisa isso.
 */
export async function countUsers(
	users: UserCounter,
	now: Date = new Date()
): Promise<UserCountsMetric> {
	const count = (filter?: UserCountFilter) =>
		users.countDocuments(filter).exec();

	const [
		total,
		newLast7Days,
		newLast30Days,
		activeLast24h,
		activeLast7Days,
		activeLast30Days,
	] = await Promise.all([
		count(),
		count({ createdAt: { $gte: daysAgo(now, 7) } }),
		count({ createdAt: { $gte: daysAgo(now, 30) } }),
		count({ lastSeenAt: { $gte: daysAgo(now, 1) } }),
		count({ lastSeenAt: { $gte: daysAgo(now, 7) } }),
		count({ lastSeenAt: { $gte: daysAgo(now, 30) } }),
	]);

	return {
		total,
		newLast7Days,
		newLast30Days,
		activeLast24h,
		activeLast7Days,
		activeLast30Days,
	};
}
