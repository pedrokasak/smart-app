import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_PUBLISHER } from 'src/events/application/ports/event-publisher.port';
import { EVENT_SUBSCRIBER } from 'src/events/application/ports/event-subscriber.port';
import { InProcessEventBus } from 'src/events/infrastructure/in-process-event-bus';

/**
 * Barramento de eventos de dominio (TRA-136, fase 1).
 *
 * `@Global` de proposito: qualquer modulo de dominio pode injetar
 * EVENT_PUBLISHER sem que exista um grafo de imports cruzados entre
 * dominio e transporte. E o inverso do acoplamento — o dominio nao importa
 * o modulo do transporte, so o simbolo da porta.
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
		InProcessEventBus,
		{ provide: EVENT_PUBLISHER, useExisting: InProcessEventBus },
		{ provide: EVENT_SUBSCRIBER, useExisting: InProcessEventBus },
	],
	exports: [EVENT_PUBLISHER, EVENT_SUBSCRIBER],
})
export class EventsModule {}
