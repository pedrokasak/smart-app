import {
	TEST_DB_PREFIX,
	assertDisposableDb,
	buildTestDbName,
} from './mongo-test-database';

describe('mongo test database guard', () => {
	it('generates a unique name with the disposable prefix', () => {
		const a = buildTestDbName();
		expect(a.startsWith(TEST_DB_PREFIX)).toBe(true);
		expect(buildTestDbName()).not.toBe(a);
		expect(() => assertDisposableDb(a)).not.toThrow();
	});

	it('throws for a database that was not generated', () => {
		expect(() => assertDisposableDb('trackerr')).toThrow(/Refusing to drop/);
		expect(() => assertDisposableDb('test')).toThrow();
		expect(() => assertDisposableDb('')).toThrow();
	});
});
