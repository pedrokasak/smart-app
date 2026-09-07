import { HttpException, HttpStatus } from '@nestjs/common';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';

/**
 * As rotas de código de recuperação precisam estar sob o mesmo teto de
 * `/auth/2fa/authenticate`.
 *
 * Um código de recuperação é um *bypass* do segundo fator. Se o consumo caísse
 * no limite padrão de 300/min, o endpoint mais permissivo passaria a ser
 * justamente o que dispensa o autenticador — e o limite de 5/min do
 * `/auth/2fa/authenticate` viraria decoração.
 */
const buildRequest = (method: string, path: string) => ({
	method,
	path,
	ip: '127.0.0.1',
	headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
	socket: { remoteAddress: '127.0.0.1' },
});

/** Quantas passagens o middleware permite antes de recusar. */
const allowedCalls = (method: string, path: string): number => {
	const middleware = new EndpointRateLimitMiddleware();
	const req: any = buildRequest(method, path);
	const res: any = { setHeader: jest.fn() };
	const next = jest.fn();

	for (let attempt = 0; attempt < 400; attempt += 1) {
		try {
			middleware.use(req, res, next);
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).getStatus()).toBe(
				HttpStatus.TOO_MANY_REQUESTS
			);
			return next.mock.calls.length;
		}
	}

	return next.mock.calls.length;
};

describe('EndpointRateLimitMiddleware — códigos de recuperação', () => {
	const authenticateLimit = allowedCalls('POST', '/auth/2fa/authenticate');

	it('o consumo não é mais frouxo que /auth/2fa/authenticate', () => {
		const consumeLimit = allowedCalls(
			'POST',
			'/auth/2fa/recovery-codes/consume'
		);

		expect(consumeLimit).toBeLessThanOrEqual(authenticateLimit);
		expect(consumeLimit).toBe(5);
	});

	it('a geração tem o mesmo teto das demais rotas de 2FA', () => {
		expect(allowedCalls('POST', '/auth/2fa/recovery-codes/generate')).toBe(5);
	});

	it('o status é leitura sem segredo, mas ainda assim limitado', () => {
		const statusLimit = allowedCalls('GET', '/auth/2fa/recovery-codes/status');

		expect(statusLimit).toBe(30);
		// Bem abaixo do padrão de 300/min: contar códigos restantes não é
		// motivo para um canal de polling barato contra o banco.
		expect(statusLimit).toBeLessThan(300);
	});

	it('as rotas novas não caem no limite padrão por falta de chave', () => {
		// Sanidade da checagem acima: uma rota sem regra própria realmente
		// recebe 300/min, então os números acima vêm de entradas explícitas.
		expect(allowedCalls('POST', '/auth/2fa/recovery-codes/inexistente')).toBe(
			300
		);
	});
});
