import { InvalidCursorError } from './ports/store-errors';
import {
	decodeRelationshipCursor,
	encodeRelationshipCursor,
} from './relationship-cursor';

describe('relationship cursor', () => {
	it('round trips (createdAt, id) as base64url', () => {
		const cursor = {
			createdAt: new Date('2026-03-04T05:06:07.089Z'),
			id: 'rel-1',
		};
		const raw = encodeRelationshipCursor(cursor);

		expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeRelationshipCursor(raw)).toEqual(cursor);
	});

	it.each([
		'',
		'not-a-cursor',
		Buffer.from('{"c":"nope","i":"x"}').toString('base64url'),
		Buffer.from('{"c":"2026-01-01T00:00:00Z"}').toString('base64url'),
	])('rejects the malformed cursor %p', (raw) => {
		expect(() => decodeRelationshipCursor(raw)).toThrow(InvalidCursorError);
	});
});
