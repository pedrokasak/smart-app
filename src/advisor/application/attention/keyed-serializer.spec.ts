import { KeyedSerializer } from './keyed-serializer';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};

describe('KeyedSerializer', () => {
	it('runs tasks of the same key one after the other, in arrival order', async () => {
		const serializer = new KeyedSerializer();
		const gate = deferred();
		const events: string[] = [];

		const first = serializer.run('k', async () => {
			events.push('first:start');
			await gate.promise;
			events.push('first:end');
			return 1;
		});
		const second = serializer.run('k', async () => {
			events.push('second:start');
			return 2;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(events).toEqual(['first:start']);

		gate.resolve();
		expect(await Promise.all([first, second])).toEqual([1, 2]);
		expect(events).toEqual(['first:start', 'first:end', 'second:start']);
	});

	it('runs different keys at the same time', async () => {
		const serializer = new KeyedSerializer();
		const gate = deferred();
		const events: string[] = [];

		const a = serializer.run('a', async () => {
			events.push('a');
			await gate.promise;
		});
		const b = serializer.run('b', async () => {
			events.push('b');
		});
		await b;
		expect(events).toEqual(['a', 'b']);
		gate.resolve();
		await a;
	});

	it('a failed task rejects its caller only; the next one still runs', async () => {
		const serializer = new KeyedSerializer();
		const failed = serializer.run('k', async () => {
			throw new Error('boom');
		});
		const next = serializer.run('k', async () => 'ok');

		await expect(failed).rejects.toThrow('boom');
		await expect(next).resolves.toBe('ok');
		expect(serializer.size).toBe(0);
	});
});
