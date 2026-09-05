import { Logger } from '@nestjs/common';

const filaMock = () => ({
	add: jest.fn(),
	getJob: jest.fn(),
	close: jest.fn().mockResolvedValue(undefined),
});

const filas: Record<string, ReturnType<typeof filaMock>> = {};

jest.mock('bullmq', () => ({
	Queue: jest.fn().mockImplementation((name: string) => {
		filas[name] = filas[name] ?? filaMock();
		return filas[name];
	}),
}));

jest.mock('ioredis', () => ({
	Redis: jest.fn().mockImplementation(() => ({
		on: jest.fn(),
		connect: jest.fn().mockResolvedValue(undefined),
		disconnect: jest.fn(),
	})),
}));

import { BullmqEventQueueAdapter } from './bullmq-event-queue.adapter';
import { EventQueueConfig, loadEventQueueConfig } from './queue.config';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';

describe('BullmqEventQueueAdapter', () => {
	const config = (patch: Partial<EventQueueConfig> = {}): EventQueueConfig => ({
		...loadEventQueueConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
		...patch,
	});

	const evento = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'user-1',
			producer: 'server.dividends',
			payload: { symbol: 'PETR4', amount: 10 },
		});

	let cfg: EventQueueConfig;
	let adapter: BullmqEventQueueAdapter;

	beforeEach(() => {
		for (const nome of Object.keys(filas)) delete filas[nome];
		jest.clearAllMocks();
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

		cfg = config();
		adapter = new BullmqEventQueueAdapter(cfg);
	});

	afterEach(() => jest.restoreAllMocks());

	const principal = () => filas[cfg.queueName];
	const deadLetter = () => filas[cfg.deadLetterQueueName];

	describe('enqueue', () => {
		it('usa event.id como jobId — a deduplicacao nativa do BullMQ', async () => {
			principal().getJob.mockResolvedValue(undefined);
			principal().add.mockResolvedValue({ id: 'x' });

			const event = evento();
			await adapter.enqueue(event);

			expect(principal().add).toHaveBeenCalledWith(
				event.type,
				event,
				expect.objectContaining({ jobId: event.id })
			);
		});

		it('devolve o proprio event.id como jobId', async () => {
			principal().getJob.mockResolvedValue(undefined);
			const event = evento();
			principal().add.mockResolvedValue({ id: event.id });

			await expect(adapter.enqueue(event)).resolves.toEqual({
				outcome: 'enqueued',
				jobId: event.id,
			});
		});

		// Criterio de aceite: reprocessar o mesmo event.id nao gera duplicata.
		it('nao reenfileira um event.id que ja esta na fila', async () => {
			const event = evento();
			principal().getJob.mockResolvedValue({ id: event.id });

			await expect(adapter.enqueue(event)).resolves.toEqual({
				outcome: 'duplicate',
				jobId: event.id,
			});
			expect(principal().add).not.toHaveBeenCalled();
		});

		it('aplica retry exponencial e retencao vindos da config', async () => {
			principal().getJob.mockResolvedValue(undefined);
			principal().add.mockResolvedValue({ id: 'x' });

			await adapter.enqueue(evento());

			expect(principal().add).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Object),
				expect.objectContaining({
					attempts: cfg.attempts,
					backoff: { type: 'exponential', delay: cfg.backoffMs },
					removeOnComplete: {
						age: cfg.keepCompletedSeconds,
						count: cfg.keepCompletedCount,
					},
					removeOnFail: { age: cfg.keepFailedSeconds },
				})
			);
		});

		// Criterio de aceite: Redis indisponivel nao derruba o request.
		it('Redis fora do ar vira outcome unavailable, nunca excecao', async () => {
			principal().getJob.mockRejectedValue(
				new Error('connect ECONNREFUSED 127.0.0.1:6379')
			);

			const resultado = await adapter.enqueue(evento());

			expect(resultado.outcome).toBe('unavailable');
			expect(resultado.error).toContain('ECONNREFUSED');
		});

		it('Redis que nao responde estoura o timeout e vira unavailable', async () => {
			const curto = config({ enqueueTimeoutMs: 20 });
			const outro = new BullmqEventQueueAdapter(curto);
			principal().getJob.mockReturnValue(new Promise(() => undefined));

			const resultado = await outro.enqueue(evento());

			expect(resultado.outcome).toBe('unavailable');
			expect(resultado.error).toContain('timeout');
		});

		it('com a fila desligada nao abre conexao e devolve unavailable', async () => {
			jest.clearAllMocks();
			const desligada = new BullmqEventQueueAdapter(config({ enabled: false }));

			const { Redis } = jest.requireMock('ioredis');
			expect(Redis).not.toHaveBeenCalled();
			expect(desligada.observableQueues()).toEqual([]);
			await expect(desligada.enqueue(evento())).resolves.toEqual({
				outcome: 'unavailable',
				error: 'fila de eventos desligada',
			});
		});
	});

	describe('dead-letter', () => {
		it('grava envelope, motivo e tentativas na fila terminal', async () => {
			deadLetter().add.mockResolvedValue({ id: 'dl' });
			const event = evento();

			await adapter.sendToDeadLetter(event, 'Resend fora', 5);

			expect(deadLetter().add).toHaveBeenCalledWith(
				event.type,
				expect.objectContaining({
					event,
					reason: 'Resend fora',
					attemptsMade: 5,
				}),
				expect.objectContaining({ jobId: event.id })
			);
		});

		it('retem o job da dead-letter indefinidamente', async () => {
			deadLetter().add.mockResolvedValue({ id: 'dl' });

			await adapter.sendToDeadLetter(evento(), 'motivo', 5);

			expect(deadLetter().add).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Object),
				expect.objectContaining({
					removeOnComplete: false,
					removeOnFail: false,
				})
			);
		});

		it('falha ao gravar na dead-letter e logada, nunca propagada', async () => {
			deadLetter().add.mockRejectedValue(new Error('Redis fora'));

			await expect(
				adapter.sendToDeadLetter(evento(), 'motivo', 5)
			).resolves.toBeUndefined();
			expect(Logger.prototype.error).toHaveBeenCalledWith(
				expect.stringContaining('dead-letter')
			);
		});
	});

	it('expoe fila principal e dead-letter para a bull-board', () => {
		expect(adapter.observableQueues()).toHaveLength(2);
	});

	it('fecha filas e conexao no destroy', async () => {
		await adapter.onModuleDestroy();
		expect(principal().close).toHaveBeenCalled();
		expect(deadLetter().close).toHaveBeenCalled();
	});
});
