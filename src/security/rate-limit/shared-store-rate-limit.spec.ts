import { HttpException, HttpStatus } from '@nestjs/common';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';
import { InMemoryRateLimitStore } from 'src/security/rate-limit/infrastructure/in-memory-rate-limit.store';
import {
	RateLimitHit,
	RateLimitStore,
} from 'src/security/rate-limit/application/ports/rate-limit-store.port';

/**
 * O ponto da TRA-138: o contador precisa ser COMPARTILHADO.
 *
 * Cada instancia do middleware aqui representa uma instancia do servidor
 * atras do proxy. Com contador proprio, "12 por minuto" vira "12 x N" — em
 * silencio. Os testes abaixo provam os dois lados: o bug (contadores
 * separados) e a correcao (um contador so).
 */
const buildRequest = (path = '/auth/signin', method = 'POST') =>
	({
		method,
		path,
		ip: '127.0.0.1',
		headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
		socket: { remoteAddress: '127.0.0.1' },
	}) as never;

const buildRes = () => ({ setHeader: jest.fn() }) as never;

/** Passa a requisicao e devolve `true` se ela foi barrada com 429. */
const foiBarrada = async (
	middleware: EndpointRateLimitMiddleware,
	req: never,
	res: never,
	next: jest.Mock
): Promise<boolean> => {
	try {
		await middleware.use(req, res, next);
		return false;
	} catch (error) {
		expect(error).toBeInstanceOf(HttpException);
		expect((error as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
		return true;
	}
};

describe('rate limit com contador compartilhado (TRA-138)', () => {
	it('duas instancias apontadas para o mesmo store somam no MESMO limite', async () => {
		const store = new InMemoryRateLimitStore();
		const instanciaA = new EndpointRateLimitMiddleware(store);
		const instanciaB = new EndpointRateLimitMiddleware(store);
		const req = buildRequest();
		const res = buildRes();
		const next = jest.fn();

		// 12 é o teto de POST:/auth/signin. Divididas entre as duas
		// instancias, ainda somam 12.
		for (let i = 0; i < 6; i += 1) {
			expect(await foiBarrada(instanciaA, req, res, next)).toBe(false);
			expect(await foiBarrada(instanciaB, req, res, next)).toBe(false);
		}

		expect(next).toHaveBeenCalledTimes(12);

		// A 13ª é barrada, tanto faz em qual instancia ela caia.
		expect(await foiBarrada(instanciaB, req, res, next)).toBe(true);
		expect(await foiBarrada(instanciaA, req, res, next)).toBe(true);
		expect(next).toHaveBeenCalledTimes(12);
	});

	it('com stores separados o limite multiplica — o bug que a issue corrige', async () => {
		const instanciaA = new EndpointRateLimitMiddleware(
			new InMemoryRateLimitStore()
		);
		const instanciaB = new EndpointRateLimitMiddleware(
			new InMemoryRateLimitStore()
		);
		const req = buildRequest();
		const res = buildRes();
		const next = jest.fn();

		for (let i = 0; i < 12; i += 1) {
			expect(await foiBarrada(instanciaA, req, res, next)).toBe(false);
			expect(await foiBarrada(instanciaB, req, res, next)).toBe(false);
		}

		// 24 passagens sob um limite escrito como 12: e o que acontece hoje
		// com duas instancias e contador em memoria.
		expect(next).toHaveBeenCalledTimes(24);
	});

	it('store indisponivel nao barra requisicao (fail open)', async () => {
		const storeFora: RateLimitStore = {
			hit: (): Promise<RateLimitHit> =>
				Promise.resolve({ outcome: 'unavailable', error: 'ECONNREFUSED' }),
		};
		const middleware = new EndpointRateLimitMiddleware(storeFora);
		const req = buildRequest();
		const res = buildRes();
		const next = jest.fn();

		// Muito acima de qualquer teto configurado: sem contador nao ha
		// decisao a tomar, e derrubar o login inteiro porque o Redis piscou
		// seria a troca errada.
		for (let i = 0; i < 400; i += 1) {
			expect(await foiBarrada(middleware, req, res, next)).toBe(false);
		}

		expect(next).toHaveBeenCalledTimes(400);
	});

	it('a janela e FIXA: expirada, a contagem recomeca do zero', async () => {
		const store = new InMemoryRateLimitStore();
		const janelaMs = 40;

		for (let i = 0; i < 3; i += 1) {
			expect(await store.hit('chave', janelaMs)).toMatchObject({
				outcome: 'counted',
				count: i + 1,
			});
		}

		await new Promise((resolve) => setTimeout(resolve, janelaMs + 20));

		// Nao e sliding window: passada a janela inteira, o contador zera de
		// uma vez em vez de escorregar.
		expect(await store.hit('chave', janelaMs)).toMatchObject({
			outcome: 'counted',
			count: 1,
		});
	});
});
