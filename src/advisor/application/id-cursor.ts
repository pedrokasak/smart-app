import { InvalidCursorError } from './ports/store-errors';

/** Cursor opaco de listas ordenadas só por id: base64url de `{ i: id }`. */
export function encodeIdCursor(id: string): string {
	return Buffer.from(JSON.stringify({ i: id })).toString('base64url');
}

export function decodeIdCursor(raw: string): string {
	try {
		const parsed = JSON.parse(
			Buffer.from(raw, 'base64url').toString('utf8')
		) as { i?: unknown };
		if (typeof parsed.i !== 'string' || parsed.i === '') {
			throw new InvalidCursorError();
		}
		return parsed.i;
	} catch {
		throw new InvalidCursorError();
	}
}
