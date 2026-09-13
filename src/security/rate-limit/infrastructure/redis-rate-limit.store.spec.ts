import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';

type LuaDef = { numberOfKeys: number; lua: string };

/**
 * Cliente ioredis de mentira. O prefixo `Mock` no nome nao e estilo: o
 * hoisting do `jest.mock` so aceita referenciar variaveis fora do escopo
 * quando elas comecam com `mock`.
 */
class MockRedis extends EventEmitter {
	static ultima: MockRedis | undefined;

	public definido: (LuaDef & { nome: string }) | undefined;
	public chamadas: Array<{ key: string; window: string }> = [];
	public responder: () => Promise<[number, number]> = () =>
		Promise.resolve([1, 60_000]);

	constructor(public readonly options: Record<string, unknown>) {
		super();
		MockRedis.ultima = this;
	}

	defineCommand(nome: string, def: LuaDef): void {
		this.definido = { nome, ...def };
		(this as unknown as Record<string, unknown>)[nome] = (
			key: string,
			window: string
		) => {
			this.chamadas.push({ key, window });
			return this.responder();
		};
	}

	connect(): Promise<void> {
		return Promise.resolve();
	}

	disconnect(): void {}
}

jest.mock('ioredis', () => ({ Redis: MockRedis }));

// `require` e nao `import`: o `jest.mock` acima e icado para o topo do
// arquivo, entao um import estatico do store carregaria o modulo — e o
// 'ioredis' de mentira — antes da classe MockRedis existir.
/* eslint-disable @typescript-eslint/no-var-requires */
const storeModule =
	require('src/security/rate-limit/infrastructure/redis-rate-limit.store') as typeof import('src/security/rate-limit/infrastructure/redis-rate-limit.store');
/* eslint-enable @typescript-eslint/no-var-requires */

const { RedisRateLimitStore, RATE_LIMIT_KEY_PREFIX } = storeModule;

const criarStore = (commandTimeoutMs = 500) =>
	new RedisRateLimitStore({
		connection: { host: 'localhost', port: 6379, db: 0 },
		commandTimeoutMs,
	});

describe('RedisRateLimitStore (TRA-138)', () => {
	let erros: jest.SpyInstance;
	let logs: jest.SpyInstance;

	beforeEach(() => {
		MockRedis.ultima = undefined;
		erros = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
		logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('registra um unico script Lua que incrementa E expira a chave', () => {
		criarStore();
		const script = MockRedis.ultima?.definido;

		expect(script?.numberOfKeys).toBe(1);
		// Atomicidade: um script so, nao INCR seguido de EXPIRE em duas idas
		// ao Redis com uma janela de corrida no meio.
		expect(script?.lua).toContain("redis.call('INCR', KEYS[1])");
		// TTL sempre presente: chave abandonada expira em vez de acumular.
		expect(script?.lua).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[1])");
		// E o TTL restante e lido para montar o Retry-After da janela em curso.
		expect(script?.lua).toContain("redis.call('PTTL', KEYS[1])");
	});

	it('nao empilha comandos com o Redis fora (enableOfflineQueue desligado)', () => {
		criarStore();
		expect(MockRedis.ultima?.options.enableOfflineQueue).toBe(false);
	});

	it('namespaceia a chave e manda a janela em ms', async () => {
		const store = criarStore();
		await store.hit('POST:/auth/signin:abc', 60_000);

		expect(MockRedis.ultima?.chamadas).toEqual([
			{
				key: `${RATE_LIMIT_KEY_PREFIX}POST:/auth/signin:abc`,
				window: '60000',
			},
		]);
		// Prefixo proprio: nao pode colidir com as chaves `bull:` do BullMQ,
		// que dividem o mesmo Redis.
		expect(RATE_LIMIT_KEY_PREFIX.startsWith('trackerr:')).toBe(true);
	});

	it('devolve o TTL restante como resetInMs', async () => {
		const store = criarStore();
		MockRedis.ultima.responder = () => Promise.resolve([7, 12_345]);

		await expect(store.hit('k', 60_000)).resolves.toEqual({
			outcome: 'counted',
			count: 7,
			resetInMs: 12_345,
		});
	});

	it('falha do Redis vira unavailable (fail open) e loga UMA vez', async () => {
		const store = criarStore();
		MockRedis.ultima.responder = () =>
			Promise.reject(new Error('ECONNREFUSED'));

		for (let i = 0; i < 50; i += 1) {
			await expect(store.hit('k', 60_000)).resolves.toMatchObject({
				outcome: 'unavailable',
			});
		}

		// 50 falhas, 1 linha de log. Log por requisicao durante uma queda de
		// Redis e um segundo incidente empilhado no primeiro.
		expect(erros).toHaveBeenCalledTimes(1);

		// E volta a logar quando o Redis se recupera, senao a degradacao
		// ficaria sem fim visivel.
		MockRedis.ultima.responder = () => Promise.resolve([1, 60_000]);
		await store.hit('k', 60_000);
		expect(logs).toHaveBeenCalledTimes(1);

		// Nova queda depois da recuperacao volta a logar — uma vez.
		MockRedis.ultima.responder = () => Promise.reject(new Error('de novo'));
		await store.hit('k', 60_000);
		await store.hit('k', 60_000);
		expect(erros).toHaveBeenCalledTimes(2);
	});

	it('Redis pendurado nao segura o request alem do teto de espera', async () => {
		const store = criarStore(50);
		MockRedis.ultima.responder = () => new Promise<never>(() => undefined);

		const inicio = Date.now();
		await expect(store.hit('k', 60_000)).resolves.toMatchObject({
			outcome: 'unavailable',
		});
		expect(Date.now() - inicio).toBeLessThan(1_000);
	});

	it('erro emitido pelo cliente nao derruba o processo', () => {
		criarStore();
		expect(() =>
			MockRedis.ultima?.emit('error', new Error('conexao caiu'))
		).not.toThrow();
		expect(erros).toHaveBeenCalledTimes(1);
	});
});
