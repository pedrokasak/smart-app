import { Logger, Module } from '@nestjs/common';
import { RATE_LIMIT_STORE } from 'src/security/rate-limit/application/ports/rate-limit-store.port';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';
import { InMemoryRateLimitStore } from 'src/security/rate-limit/infrastructure/in-memory-rate-limit.store';
import { RedisRateLimitStore } from 'src/security/rate-limit/infrastructure/redis-rate-limit.store';
import { loadEventQueueConfig } from 'src/events/infrastructure/bullmq/queue.config';

/**
 * Escolhe onde o contador do rate limit mora (TRA-138).
 *
 * A conexao NAO e configurada aqui: reusa `loadEventQueueConfig()`, o mesmo
 * schema que ja le REDIS_HOST/PORT/PASSWORD/DB para a fila de eventos. Um
 * segundo conjunto de variaveis para o mesmo Redis so criaria duas fontes de
 * verdade divergindo no primeiro deploy. A CONEXAO e reusada (mesmo
 * endereco); o CLIENTE e proprio, porque o do produtor da fila pertence ao
 * BullMQ e nao deve receber comandos de terceiros.
 *
 * `config.enabled` e o interruptor: ele ja significa "este deploy tem um
 * Redis" (e ja e false sob NODE_ENV=test, evitando exigir Redis no CI).
 * Sem Redis o contador cai para o Map em memoria — que e o comportamento
 * anterior a esta issue, correto para instancia unica e errado, de forma
 * conhecida, para varias.
 */
export function criarRateLimitStore():
	| InMemoryRateLimitStore
	| RedisRateLimitStore {
	const logger = new Logger('RateLimitModule');

	let config: ReturnType<typeof loadEventQueueConfig>;
	try {
		config = loadEventQueueConfig();
	} catch (err) {
		logger.error(
			`${(err as Error).message} — rate limit usando contador em memoria`
		);
		return new InMemoryRateLimitStore();
	}

	if (!config.enabled) {
		return new InMemoryRateLimitStore();
	}

	logger.log(
		'Rate limit por endpoint com contador no Redis (compartilhado entre instancias).'
	);

	return new RedisRateLimitStore({
		connection: config.connection,
		// Mesmo teto de espera do enfileiramento: a pergunta e a mesma —
		// quanto um request pode esperar por este Redis antes de seguir sem
		// ele.
		commandTimeoutMs: config.enqueueTimeoutMs,
	});
}

@Module({
	providers: [
		{ provide: RATE_LIMIT_STORE, useFactory: criarRateLimitStore },
		EndpointRateLimitMiddleware,
	],
	exports: [EndpointRateLimitMiddleware],
})
export class RateLimitModule {}
