import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { EventQueueWorker } from './event-queue.worker';
import { EventQueueConfig, loadEventQueueConfig } from './queue.config';
import { BullmqEventQueueAdapter } from './bullmq-event-queue.adapter';
import { EventConsumer } from 'src/events/application/ports/event-consumer.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';

describe('EventQueueWorker', () => {
	// NODE_ENV=test ja desliga a fila, entao nenhuma conexao com Redis e
	// aberta neste suite: o que se testa aqui e o processamento, que e regra.
	const config = (): EventQueueConfig =>
		loadEventQueueConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

	const dividendo = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'user-1',
			producer: 'server.dividends',
			payload: { symbol: 'PETR4', amount: 10 },
		});

	const consumidor = (
		pattern: string,
		name = pattern
	): EventConsumer & {
		handle: jest.Mock;
	} => ({
		name,
		pattern,
		handle: jest.fn().mockResolvedValue(undefined),
	});

	const criar = (consumidores: EventConsumer[] = []) =>
		new EventQueueWorker(
			config(),
			{ sendToDeadLetter: jest.fn() } as unknown as BullmqEventQueueAdapter,
			consumidores
		);

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('nao abre worker quando a fila esta desligada', () => {
		const worker = criar();
		expect(() => worker.onApplicationBootstrap()).not.toThrow();
	});

	it('roteia o evento so para os consumidores cujo padrao casa', async () => {
		const exato = consumidor(DOMAIN_EVENT_TYPES.DividendReceived);
		const prefixo = consumidor('portfolio.**');
		const tudo = consumidor('**');
		const outro = consumidor('market.**');

		const worker = criar([exato, prefixo, tudo, outro]);
		const event = dividendo();
		await worker.process({ id: event.id, data: event });

		expect(exato.handle).toHaveBeenCalledWith(event);
		expect(prefixo.handle).toHaveBeenCalledWith(event);
		expect(tudo.handle).toHaveBeenCalledWith(event);
		expect(outro.handle).not.toHaveBeenCalled();
	});

	it('evento sem consumidor conclui o job em silencio', async () => {
		const worker = criar([consumidor('market.**')]);
		const event = dividendo();

		await expect(
			worker.process({ id: event.id, data: event })
		).resolves.toBeUndefined();
	});

	it('sem nenhum consumidor registrado (estado da fase 2) o job passa', async () => {
		const worker = criar();
		const event = dividendo();

		await expect(
			worker.process({ id: event.id, data: event })
		).resolves.toBeUndefined();
	});

	it('propaga a falha do consumidor para o BullMQ aplicar o backoff', async () => {
		const quebrado = consumidor('**');
		quebrado.handle.mockRejectedValue(new Error('Resend fora do ar'));
		const worker = criar([quebrado]);
		const event = dividendo();

		await expect(worker.process({ id: event.id, data: event })).rejects.toThrow(
			'Resend fora do ar'
		);
	});

	it('envelope invalido vira UnrecoverableError — repetir nao adianta', async () => {
		const worker = criar([consumidor('**')]);

		await expect(
			worker.process({ id: 'x', data: { nao: 'e um envelope' } })
		).rejects.toBeInstanceOf(UnrecoverableError);
	});

	it('envelope que atravessou serializacao continua valido', async () => {
		const alvo = consumidor('**');
		const worker = criar([alvo]);
		const event = dividendo();
		const serializado = JSON.parse(JSON.stringify(event)) as DomainEvent;

		await worker.process({ id: event.id, data: serializado });

		expect(alvo.handle).toHaveBeenCalledWith(serializado);
	});

	it('executa os consumidores em sequencia, nao em paralelo', async () => {
		const ordem: string[] = [];
		const primeiro = consumidor('**', 'primeiro');
		primeiro.handle.mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 10));
			ordem.push('primeiro');
		});
		const segundo = consumidor('**', 'segundo');
		segundo.handle.mockImplementation(async () => {
			ordem.push('segundo');
		});

		const worker = criar([primeiro, segundo]);
		const event = dividendo();
		await worker.process({ id: event.id, data: event });

		expect(ordem).toEqual(['primeiro', 'segundo']);
	});
});
