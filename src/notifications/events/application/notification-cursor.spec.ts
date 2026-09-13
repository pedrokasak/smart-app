import { Types } from 'mongoose';
import {
	decodeNotificationCursor,
	encodeNotificationCursor,
} from './notification-cursor';

describe('notification cursor', () => {
	it('faz round-trip preservando createdAt e id', () => {
		const createdAt = new Date('2026-03-01T12:34:56.789Z');
		const id = new Types.ObjectId();

		const decoded = decodeNotificationCursor(
			encodeNotificationCursor({ createdAt, id })
		);

		expect(decoded).not.toBeNull();
		expect(decoded!.createdAt.toISOString()).toBe(createdAt.toISOString());
		expect(decoded!.id.toString()).toBe(id.toString());
	});

	it('e opaco: nao expoe o id em texto claro', () => {
		const id = new Types.ObjectId();
		const cursor = encodeNotificationCursor({ createdAt: new Date(), id });
		expect(cursor).not.toContain(id.toString());
	});

	it.each([
		['vazio', ''],
		['undefined', undefined],
		['lixo nao-base64', '!!!nao-e-cursor!!!'],
		['base64 de json invalido', Buffer.from('nao json').toString('base64url')],
		[
			'json sem os campos esperados',
			Buffer.from(JSON.stringify({ x: 1 })).toString('base64url'),
		],
		[
			'id que nao e ObjectId',
			Buffer.from(
				JSON.stringify({ c: new Date().toISOString(), i: 'abc' })
			).toString('base64url'),
		],
		[
			'data invalida',
			Buffer.from(
				JSON.stringify({ c: 'nao-e-data', i: new Types.ObjectId().toString() })
			).toString('base64url'),
		],
	])('devolve null para cursor %s em vez de estourar', (_label, value) => {
		expect(decodeNotificationCursor(value as string | undefined)).toBeNull();
	});
});
