import { jest } from '@jest/globals';
import { TtlPromiseCache } from './ttl-promise-cache';

describe('TtlPromiseCache', () => {
	let clock: number;
	const now = () => clock;

	beforeEach(() => {
		clock = 0;
	});

	it('returns the cached value within the TTL without loading again', async () => {
		const cache = new TtlPromiseCache<number>(1000, 10, now);
		const load = jest.fn(async () => 42);

		await cache.getOrLoad('k', load);
		clock = 999;
		const value = await cache.getOrLoad('k', load);

		expect(value).toBe(42);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('loads again after the TTL expires', async () => {
		const cache = new TtlPromiseCache<number>(1000, 10, now);
		const load = jest.fn(async () => 42);

		await cache.getOrLoad('k', load);
		clock = 1000;
		await cache.getOrLoad('k', load);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shares one in-flight load between concurrent callers', async () => {
		const cache = new TtlPromiseCache<number>(1000, 10, now);
		let resolve!: (value: number) => void;
		const load = jest.fn(() => new Promise<number>((r) => (resolve = r)));

		const first = cache.getOrLoad('k', load);
		const second = cache.getOrLoad('k', load);
		resolve(7);

		await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('does not cache failures', async () => {
		const cache = new TtlPromiseCache<number>(1000, 10, now);
		const load = jest
			.fn<() => Promise<number>>()
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce(5);

		await expect(cache.getOrLoad('k', load)).rejects.toThrow('down');
		await expect(cache.getOrLoad('k', load)).resolves.toBe(5);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('evicts the oldest entry when the limit is exceeded', async () => {
		const cache = new TtlPromiseCache<string>(1000, 2, now);
		const load = jest.fn(async () => 'v');

		await cache.getOrLoad('a', load);
		await cache.getOrLoad('b', load);
		await cache.getOrLoad('c', load);
		await cache.getOrLoad('a', load);

		expect(load).toHaveBeenCalledTimes(4);
	});
});
