import { Types } from 'mongoose';

/**
 * Cursor de paginacao do centro in-app.
 *
 * Keyset, nao offset: com `skip` uma notificacao nova chegando entre duas
 * paginas empurra a lista e o usuario ve o mesmo item duas vezes. Aqui a
 * proxima pagina e "tudo que vem estritamente depois deste (createdAt, _id)"
 * na ordem decrescente — imune a insercoes no topo.
 *
 * `_id` entra como desempate porque `createdAt` tem resolucao de
 * milissegundo: duas notificacoes do mesmo lote colidem, e sem desempate
 * uma delas seria pulada ou repetida.
 *
 * Formato opaco de proposito (base64url de um JSON pequeno). O cliente so
 * devolve o que recebeu; nada aqui e confiavel e tudo e revalidado.
 */
export type NotificationCursor = {
	createdAt: Date;
	id: Types.ObjectId;
};

export function encodeNotificationCursor(cursor: {
	createdAt: Date;
	id: Types.ObjectId | string;
}): string {
	const raw = JSON.stringify({
		c: cursor.createdAt.toISOString(),
		i: cursor.id.toString(),
	});
	return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Devolve `null` para qualquer cursor que nao decodifique — o service trata
 * cursor invalido como "primeira pagina" em vez de estourar 500. Um cursor
 * forjado nao vaza nada: o filtro por dono e aplicado fora daqui, sempre.
 */
export function decodeNotificationCursor(
	value: string | undefined | null
): NotificationCursor | null {
	if (!value) return null;

	try {
		const raw = Buffer.from(value, 'base64url').toString('utf8');
		const parsed = JSON.parse(raw) as { c?: unknown; i?: unknown };

		if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
			return null;
		}
		if (!Types.ObjectId.isValid(parsed.i)) {
			return null;
		}

		const createdAt = new Date(parsed.c);
		if (Number.isNaN(createdAt.getTime())) {
			return null;
		}

		return { createdAt, id: new Types.ObjectId(parsed.i) };
	} catch {
		return null;
	}
}
