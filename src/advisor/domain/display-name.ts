const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;

/**
 * Nome de exibição (organização, cliente): `trim`, tamanho entre `min` e
 * `max` e sem caracteres de controle (`Cc`) nem de formatação (`Cf`, p.ex.
 * U+202E e U+200B). Devolve o nome aparado ou null se for inválido.
 */
export function normalizeDisplayName(
	raw: unknown,
	limits: { min: number; max: number }
): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.trim();
	if (name.length < limits.min || name.length > limits.max) return null;
	if (FORBIDDEN_CHARS.test(name)) return null;
	return name;
}
