import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
	RateLimitHit,
	RateLimitStore,
} from 'src/security/rate-limit/application/ports/rate-limit-store.port';

/**
 * Prefixo das chaves. `trackerr:ratelimit:` nao colide com o `bull:` que o
 * BullMQ usa no mesmo Redis (docker-compose / Coolify), e deixa obvio no
 * `SCAN` de quem e cada chave.
 */
export const RATE_LIMIT_KEY_PREFIX = 'trackerr:ratelimit:';

/**
 * Incremento atomico com janela fixa, em UMA ida ao Redis.
 *
 * Por que Lua e nao INCR + EXPIRE em dois comandos: entre um e outro o
 * processo pode morrer (deploy, OOM) e a chave ficaria SEM TTL — contador
 * eterno que barra aquele fingerprint para sempre. Um pipeline tambem nao
 * resolve: pipeline nao e atomico, so economiza round-trip. O script roda
 * inteiro ou nao roda.
 *
 * `PTTL` no ramo do else porque o middleware precisa do `Retry-After` real
 * da janela em curso, nao da janela cheia. O `ttl < 0` cobre o caso
 * degenerado de uma chave sem TTL (criada por uma versao anterior, ou um
 * `PERSIST` manual): reata a expiracao em vez de deixar o contador preso.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return {count, tonumber(ARGV[1])}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export type RedisRateLimitStoreOptions = {
	connection: {
		host: string;
		port: number;
		password?: string;
		db: number;
	};
	/**
	 * Teto de espera por comando. Um Redis inalcancavel mas que nao recusa a
	 * conexao (particao de rede, failover) nao devolve erro — so nao
	 * responde. Sem teto, o request penduraria junto, que e o oposto de
	 * degradar bem.
	 */
	commandTimeoutMs: number;
};

interface RedisComHit extends Redis {
	rateLimitHit(key: string, windowMs: string): Promise<[number, number]>;
}

/**
 * Contador do rate limit no Redis, compartilhado entre instancias (TRA-138).
 *
 * Antes desta issue o contador era um Map por processo: com N instancias
 * atras do proxy, "12 tentativas por minuto" virava "12 x N" — em silencio,
 * sem erro e sem log. Como o mesmo middleware protege `/auth/signin`, o
 * `/auth/2fa/authenticate` e os codigos de recuperacao, isso e a diferenca
 * entre forca bruta de TOTP ser impraticavel ou nao.
 *
 * DEGRADACAO: FAIL OPEN, de proposito.
 * `hit` nunca lanca; Redis fora do ar vira `outcome: 'unavailable'` e o
 * middleware deixa a requisicao passar. O custo aceito esta escrito: quem
 * conseguir derrubar o Redis ganha uma janela sem limite. O contrario —
 * fail closed — troca um ganho pequeno de seguranca por indisponibilidade
 * total do login sempre que o Redis piscar, e essa e a troca pior.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
	private readonly logger = new Logger(RedisRateLimitStore.name);
	private readonly client: RedisComHit;

	/**
	 * Guarda do log. Sem isto, um Redis fora do ar geraria uma linha de log
	 * POR REQUISICAO — ruido que enterra a causa raiz e, em pico, e um
	 * problema por si so. Loga na transicao para degradado e na volta.
	 */
	private degraded = false;

	constructor(private readonly options: RedisRateLimitStoreOptions) {
		this.client = new Redis({
			...options.connection,
			// Mesma escolha do produtor da fila (BullmqEventQueueAdapter): com
			// o Redis fora, o comando falha na hora em vez de empilhar em
			// memoria e resolver minutos depois. Um rate limit que responde
			// tarde nao serve para decidir sobre a requisicao atual.
			enableOfflineQueue: false,
			maxRetriesPerRequest: 1,
			lazyConnect: true,
			retryStrategy: (tentativas) => Math.min(tentativas * 500, 10_000),
		}) as RedisComHit;

		// `defineCommand` registra o script uma vez: o ioredis usa EVALSHA e so
		// cai para EVAL se o Redis reiniciou e perdeu o cache de scripts.
		this.client.defineCommand('rateLimitHit', {
			numberOfKeys: 1,
			lua: HIT_SCRIPT,
		});

		this.client.on('error', (err: Error) => {
			// Sem handler o ioredis emite 'error' como unhandled e derruba o
			// processo. Redis fora do ar aqui e estado degradado, nao fatal.
			this.marcarDegradado(err.message);
		});

		this.client.connect().catch((err: Error) => {
			this.marcarDegradado(err.message);
		});
	}

	async hit(key: string, windowMs: number): Promise<RateLimitHit> {
		try {
			const [count, ttl] = await this.comTimeout(
				this.client.rateLimitHit(
					`${RATE_LIMIT_KEY_PREFIX}${key}`,
					String(windowMs)
				)
			);

			this.marcarSaudavel();

			return {
				outcome: 'counted',
				count,
				resetInMs: ttl > 0 ? ttl : windowMs,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.marcarDegradado(message);
			return { outcome: 'unavailable', error: message };
		}
	}

	private comTimeout<R>(operacao: Promise<R>): Promise<R> {
		return Promise.race([
			operacao,
			new Promise<never>((_, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(
								`timeout de ${this.options.commandTimeoutMs}ms no Redis do rate limit`
							)
						),
					this.options.commandTimeoutMs
				).unref()
			),
		]);
	}

	private marcarDegradado(motivo: string): void {
		if (this.degraded) return;
		this.degraded = true;
		this.logger.error(
			`Redis do rate limit indisponivel (${motivo}). ` +
				'As requisicoes seguem sendo atendidas SEM limite por endpoint ' +
				'(fail open) ate o Redis voltar.'
		);
	}

	private marcarSaudavel(): void {
		if (!this.degraded) return;
		this.degraded = false;
		this.logger.log('Redis do rate limit voltou; limites por endpoint ativos.');
	}

	onModuleDestroy(): void {
		this.client.disconnect();
	}
}
