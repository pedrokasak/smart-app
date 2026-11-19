/**
 * JSON canônico para hash (ADR-004, seção 9.3): chaves em ordem, sem espaço,
 * `Date` como ISO, `undefined` descartado. O mesmo objeto gera sempre a
 * mesma string, em Node e em Python — sem isso, o hash de um registro mudaria
 * conforme a ordem em que o Mongo devolve as chaves.
 *
 * Recusa o que não tem forma estável (`NaN`, `Infinity`, função, símbolo,
 * `bigint`): melhor falhar ao selar do que gravar um hash que ninguém
 * consegue recalcular.
 */
export function canonicalize(value: unknown): string {
	if (value === null) return 'null';

	switch (typeof value) {
		case 'string':
		case 'boolean':
			return JSON.stringify(value);
		case 'number':
			if (!Number.isFinite(value)) {
				throw new Error(`JSON canônico não aceita o número ${value}`);
			}
			return JSON.stringify(value);
		case 'object':
			break;
		default:
			throw new Error(`JSON canônico não aceita ${typeof value}`);
	}

	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			throw new Error('JSON canônico não aceita data inválida');
		}
		return JSON.stringify(value.toISOString());
	}

	if (Array.isArray(value)) {
		// `undefined` dentro de array vira null, como no JSON.stringify.
		return `[${value.map((item) => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`;
	}

	const record = value as Record<string, unknown>;
	const entries = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
	return `{${entries.join(',')}}`;
}
