import {
	DEFAULT_INDEX_BUILD_DELAY_MS,
	resolveAutoIndex,
	resolveIndexBuildDelayMs,
} from './mongo-index-policy';

describe('resolveAutoIndex', () => {
	it('desliga em produção', () => {
		expect(resolveAutoIndex({ NODE_ENV: 'production' })).toBe(false);
	});

	it('mantém ligado fora de produção', () => {
		expect(resolveAutoIndex({ NODE_ENV: 'development' })).toBe(true);
		expect(resolveAutoIndex({ NODE_ENV: 'test' })).toBe(true);
		expect(resolveAutoIndex({})).toBe(true);
	});

	it('MONGO_AUTO_INDEX sobrescreve o padrão', () => {
		expect(
			resolveAutoIndex({ NODE_ENV: 'production', MONGO_AUTO_INDEX: 'true' })
		).toBe(true);
		expect(
			resolveAutoIndex({ NODE_ENV: 'development', MONGO_AUTO_INDEX: 'FALSE' })
		).toBe(false);
	});

	it('valor inválido em MONGO_AUTO_INDEX é ignorado', () => {
		expect(
			resolveAutoIndex({ NODE_ENV: 'production', MONGO_AUTO_INDEX: 'sim' })
		).toBe(false);
	});
});

describe('resolveIndexBuildDelayMs', () => {
	it('usa o padrão sem variável ou com valor inválido', () => {
		expect(resolveIndexBuildDelayMs({})).toBe(DEFAULT_INDEX_BUILD_DELAY_MS);
		expect(
			resolveIndexBuildDelayMs({ MONGO_INDEX_BUILD_DELAY_MS: 'abc' })
		).toBe(DEFAULT_INDEX_BUILD_DELAY_MS);
		expect(resolveIndexBuildDelayMs({ MONGO_INDEX_BUILD_DELAY_MS: '-5' })).toBe(
			DEFAULT_INDEX_BUILD_DELAY_MS
		);
	});

	it('aceita valor configurado, inclusive zero', () => {
		expect(
			resolveIndexBuildDelayMs({ MONGO_INDEX_BUILD_DELAY_MS: '5000' })
		).toBe(5000);
		expect(resolveIndexBuildDelayMs({ MONGO_INDEX_BUILD_DELAY_MS: '0' })).toBe(
			0
		);
	});
});
