import {
	InvalidEventQueueConfigError,
	loadEventQueueConfig,
} from './queue.config';

describe('loadEventQueueConfig', () => {
	const base = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

	it('sobe com defaults locais sem nenhuma variavel definida', () => {
		const config = loadEventQueueConfig(base);

		expect(config.connection).toEqual({
			host: 'localhost',
			port: 6379,
			db: 0,
		});
		expect(config.enabled).toBe(true);
		expect(config.workerEnabled).toBe(true);
	});

	it('defaults dimensionados para o burst diario de ~5 mil usuarios', () => {
		const config = loadEventQueueConfig(base);

		// ~20 jobs simultaneos IO-bound => ~100 jobs/s => 5k em ~50s.
		expect(config.concurrency).toBe(20);
		expect(config.attempts).toBe(5);
		expect(config.backoffMs).toBe(5000);
		expect(config.rateLimit).toEqual({ max: 200, durationMs: 1000 });
	});

	it('retencao de concluidos bate com a janela de dedupe de 24h', () => {
		expect(loadEventQueueConfig(base).keepCompletedSeconds).toBe(24 * 60 * 60);
	});

	it('so inclui password quando REDIS_PASSWORD esta definida', () => {
		expect(loadEventQueueConfig(base).connection).not.toHaveProperty(
			'password'
		);
		expect(
			loadEventQueueConfig({ ...base, REDIS_PASSWORD: 's3cr3t' }).connection
		).toHaveProperty('password', 's3cr3t');
	});

	it('deriva o nome da dead-letter do nome da fila', () => {
		const config = loadEventQueueConfig({
			...base,
			EVENTS_QUEUE_NAME: 'minha.fila',
		});
		expect(config.queueName).toBe('minha.fila');
		expect(config.deadLetterQueueName).toBe('minha.fila.dead-letter');
	});

	it('desliga tudo sob NODE_ENV=test — teste nao abre conexao com Redis', () => {
		const config = loadEventQueueConfig({ NODE_ENV: 'test' });
		expect(config.enabled).toBe(false);
		expect(config.workerEnabled).toBe(false);
	});

	it.each([['false'], ['0'], ['no'], ['off'], ['FALSE']])(
		'EVENTS_QUEUE_ENABLED=%s desliga a fila',
		(valor) => {
			expect(
				loadEventQueueConfig({ ...base, EVENTS_QUEUE_ENABLED: valor }).enabled
			).toBe(false);
		}
	);

	it('valor inesperado nao desliga a fila por acidente', () => {
		expect(
			loadEventQueueConfig({ ...base, EVENTS_QUEUE_ENABLED: 'sim' }).enabled
		).toBe(true);
	});

	it('permite instancia que so publica (worker desligado)', () => {
		const config = loadEventQueueConfig({
			...base,
			EVENTS_QUEUE_WORKER_ENABLED: 'false',
		});
		expect(config.enabled).toBe(true);
		expect(config.workerEnabled).toBe(false);
	});

	it('coage numeros vindos de string de ambiente', () => {
		const config = loadEventQueueConfig({
			...base,
			REDIS_PORT: '6380',
			EVENTS_QUEUE_CONCURRENCY: '50',
		});
		expect(config.connection.port).toBe(6380);
		expect(config.concurrency).toBe(50);
	});

	it('rejeita valor numerico invalido em vez de silenciar', () => {
		expect(() =>
			loadEventQueueConfig({ ...base, REDIS_PORT: 'nao-e-numero' })
		).toThrow(InvalidEventQueueConfigError);
	});
});
