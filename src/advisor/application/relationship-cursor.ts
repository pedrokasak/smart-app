import { InvalidCursorError } from './ports/store-errors';

export interface RelationshipCursor {
	createdAt: Date;
	id: string;
}

/** Cursor opaco: base64url de `{ c: createdAt ISO, i: id }`. */
export function encodeRelationshipCursor(cursor: RelationshipCursor): string {
	return Buffer.from(
		JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })
	).toString('base64url');
}

export function decodeRelationshipCursor(raw: string): RelationshipCursor {
	try {
		const parsed = JSON.parse(
			Buffer.from(raw, 'base64url').toString('utf8')
		) as { c?: unknown; i?: unknown };
		if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
			throw new InvalidCursorError();
		}
		const createdAt = new Date(parsed.c);
		if (Number.isNaN(createdAt.getTime())) throw new InvalidCursorError();
		return { createdAt, id: parsed.i };
	} catch {
		throw new InvalidCursorError();
	}
}
