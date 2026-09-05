import { Global, Logger, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_PUBLISHER } from 'src/events/application/ports/event-publisher.port';
import { EVENT_SUBSCRIBER } from 'src/events/application/ports/event-subscriber.port';
import { EVENT_QUEUE } from 'src/events/application/ports/event-queue.port';
import { EVENT_CONSUMERS } from 'src/events/application/ports/event-consumer.port';
import { EventQueueDispatcher } from 'src/events/application/event-queue.dispatcher';
import { InProcessEventBus } from 'src/events/infrastructure/in-process-event-bus';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
	loadEventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';
import { BullmqEventQueueAdapter } from 'src/events/infrastructure/bullmq/bullmq-event-queue.adapter';
import { DisabledEventQueueAdapter } from 'src/events/infrastructure/bullmq/disabled-event-queue.adapter';
import { EventQueueWorker } from 'src/events/infrastructure/bullmq/event-queue.worker';

/**
 * Barramento de eventos de dominio + fila duravel (TRA-136, fases 1 e 2).
 *
 * `@Global` de proposito: qualquer modulo de dominio pode injetar
 * EVENT_PUBLISHER sem que exista um grafo de imports cruzados entre dominio
 * e transporte. E o inverso do acoplamento — o dominio nao importa o modulo
 * do transporte, so o simbolo da porta.
 *
 * Fluxo:
 *   produtor -> EVENT_PUBLISHER (in-process, sincrono, sem infra)
 *            -> EventQueueDispatcher assina '**' e SO enfileira
 *            -> EventQueueWorker consome e roda os consumidores
 *
 * Trocar o transporte = trocar a classe apontada por EVENT_PUBLISHER /
 * EVENT_SUBSCRIBER aqui. Nenhum produtor muda.
 */
@Global()
@Module({
	imports: [
		EventEmitterModule.forRoot({
			// Casamento hierarquico documentado em EventSubscriber:
			// 'portfolio.*.received', 'portfolio.**', '**'.
			wildcard: true,
			delimiter: '.',
			// O barramento nao usa o padrao de 'newListener'/'removeListener'
			// do EventEmitter2; desligar evita ruido em listeners curinga.
			newListener: false,
			removeListener: false,
			// Um assinante por preocupacao (fila, metricas, auditoria). O teto
			// alto so evita o warning de leak em modulos que assinem varios
			// padroes; nao ha assinatura dinamica por request.
			maxListeners: 50,
			verboseMemoryLeak: true,
			// Erro de assinante e tratado no InProcessEventBus (logado, nunca
			// propagado). Deixar false evita que o EventEmitter2 derrube o
			// processo com um 'error' nao tratado.
			ignoreErrors: false,
		}),
	],
	providers: [
		// --- contrato / barramento (fase 1) ---
		InProcessEventBus,
		{ provide: EVENT_PUBLISHER, useExisting: InProcessEventBus },
		{ provide: EVENT_SUBSCRIBER, useExisting: InProcessEventBus },

		// --- fila duravel (fase 2) ---
		{
			provide: EVENT_QUEUE_CONFIG,
			useFactory: (): EventQueueConfig => {
				try {
					return loadEventQueueConfig();
				} catch (err) {
					// Config invalida degrada para fila desligada. Derrubar a API
					// inteira porque REDIS_PORT veio com letra seria pior: o
					// dominio nao depende da fila para responder.
					new Logger('EventsModule').error(
						`${(err as Error).message} — fila de eventos desligada`
					);
					return loadEventQueueConfig({ EVENTS_QUEUE_ENABLED: 'false' });
				}
			},
		},
		BullmqEventQueueAdapter,
		DisabledEventQueueAdapter,
		{
			provide: EVENT_QUEUE,
			useFactory: (
				config: EventQueueConfig,
				bullmq: BullmqEventQueueAdapter,
				desligada: DisabledEventQueueAdapter
			) => (config.enabled ? bullmq : desligada),
			inject: [
				EVENT_QUEUE_CONFIG,
				BullmqEventQueueAdapter,
				DisabledEventQueueAdapter,
			],
		},
		{
			// Consumidores chegam na fase 3 (produtores dos cinco eventos).
			// A lista vazia deixa a maquinaria completa e testavel desde ja.
			provide: EVENT_CONSUMERS,
			useValue: [],
		},
		EventQueueDispatcher,
		EventQueueWorker,
	],
	exports: [EVENT_PUBLISHER, EVENT_SUBSCRIBER, EVENT_QUEUE],
})
export class EventsModule {}
