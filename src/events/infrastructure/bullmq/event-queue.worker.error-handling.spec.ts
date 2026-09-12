import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { EventQueueWorker } from './event-queue.worker';
import { EventQueueConfig } from './queue.config';
import { BullmqEventQueueAdapter } from './bullmq-event-queue.adapter';
import { EventConsumerRegistry } from 'src/events/application/event-consumer.registry';

/**
 * TRA-153. O spec principal roda com `NODE_ENV=test`, que desliga a fila — ou
 * seja, ele nunca chega a criar o `Worker` e por isso nao pegava este bug.
 *
 * Aqui a fila e LIGADA, com `bullmq` e `ioredis` mockados, para exercitar
 * exatamente o caminho de producao: o que acontece quando o Worker emite
 * 'error'. O `Worker` do BullMQ e um EventEmitter, e EventEmitter que emite
 * 'error' sem listener lanca ERR_UNHANDLED_ERROR e derruba o processo. Foi
 * o que deixou producao em crash-loop por ~25 minutos no deploy do v1.6.0.
 */

class FakeWorker extends EventEmitter {
	close = jest.fn().mockResolvedValue(undefined);
}
class FakeRedis extends EventEmitter {
	disconnect = jest.fn();
	connect = jest.fn().mockResolvedValue(undefined);
	defineCommand = jest.fn();
}

const workers: FakeWorker[] = [];
const redises: FakeRedis[] = [];

jest.mock('bullmq', () => {
	const actual = jest.requireActual('bullmq');
	return {
		...actual,
		Worker: jest.fn().mockImplementation(() => {
			const w = new FakeWorker();
			workers.push(w);
			return w;
		}),
	};
});

jest.mock('ioredis', () => ({
	__esModule: true,
	default: jest.fn().mockImplementation(() => {
		const r = new FakeRedis();
		redises.push(r);
		return r;
	}),
	Redis: jest.fn().mockImplementation(() => {
		const r = new FakeRedis();
		redises.push(r);
		return r;
	}),
}));

describe('EventQueueWorker — resiliencia a erro do worker (fila LIGADA)', () => {
	let warnSpy: jest.SpyInstance;

	const configLigada = (): EventQueueConfig =>
		({
			enabled: true,
			workerEnabled: true,
			queueName: 'trackerr.events',
			deadLetterQueueName: 'trackerr.events.dead-letter',
			connection: { host: 'localhost', port: 6379, db: 0 },
			concurrency: 20,
			attempts: 5,
			backoffMs: 5000,
			rateLimit: { max: 200, durationMs: 1000 },
			keepCompletedSeconds: 86400,
			keepCompletedCount: 5000,
			keepFailedSeconds: 604800,
			enqueueTimeoutMs: 2000,
		}) as unknown as EventQueueConfig;

	const criar = () =>
		new EventQueueWorker(
			configLigada(),
			{ sendToDeadLetter: jest.fn() } as unknown as BullmqEventQueueAdapter,
			new EventConsumerRegistry([])
		);

	beforeEach(() => {
		workers.length = 0;
		redises.length = 0;
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		warnSpy = jest
			.spyOn(Logger.prototype, 'warn')
			.mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('registra listener de error no worker', () => {
		const worker = criar();
		worker.onApplicationBootstrap();

		expect(workers).toHaveLength(1);
		// Sem este listener, o próximo teste derrubaria o processo do Jest.
		expect(workers[0].listenerCount('error')).toBeGreaterThan(0);
	});

	/**
	 * Este é o teste que reproduz o incidente: sem Redis alcançável o BullMQ
	 * emite 'error' no worker. Antes do fix isso era ERR_UNHANDLED_ERROR.
	 */
	it('erro emitido pelo worker nao derruba o processo — degrada com warn', () => {
		const worker = criar();
		worker.onApplicationBootstrap();

		expect(() =>
			workers[0].emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379'))
		).not.toThrow();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('ECONNREFUSED')
		);
	});

	it('erro na conexao do worker tambem degrada com warn', () => {
		const worker = criar();
		worker.onApplicationBootstrap();

		expect(redises.length).toBeGreaterThan(0);
		expect(() =>
			redises[0].emit('error', new Error('Redis fora do ar'))
		).not.toThrow();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Redis fora do ar')
		);
	});

	it('nao cria worker nem conexao quando EVENTS_QUEUE_ENABLED=false', () => {
		const worker = new EventQueueWorker(
			{ ...configLigada(), enabled: false } as unknown as EventQueueConfig,
			{ sendToDeadLetter: jest.fn() } as unknown as BullmqEventQueueAdapter,
			new EventConsumerRegistry([])
		);

		worker.onApplicationBootstrap();

		// É o que destrava o deploy enquanto não existe Redis na infra.
		expect(workers).toHaveLength(0);
		expect(redises).toHaveLength(0);
	});
});
