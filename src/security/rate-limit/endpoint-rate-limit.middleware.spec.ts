import { HttpException, HttpStatus } from '@nestjs/common';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';

describe('EndpointRateLimitMiddleware', () => {
	it('allows requests below the configured limit', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const req: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.1',
			headers: {
				'user-agent': 'jest',
				'accept-language': 'pt-BR',
			},
			socket: { remoteAddress: '127.0.0.1' },
		};
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();

		for (let i = 0; i < 12; i += 1) {
			await middleware.use(req, res, next);
		}

		expect(next).toHaveBeenCalledTimes(12);
	});

	it('blocks when requests exceed route+fingerprint limit', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const req: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.1',
			headers: {
				'user-agent': 'jest',
				'accept-language': 'pt-BR',
			},
			socket: { remoteAddress: '127.0.0.1' },
		};
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();

		for (let i = 0; i < 12; i += 1) {
			await middleware.use(req, res, next);
		}

		let thrown: unknown;
		try {
			await middleware.use(req, res, next);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
		expect(res.setHeader).toHaveBeenCalledWith(
			'Retry-After',
			expect.any(String)
		);
	});

	it('keeps independent buckets for different fingerprints', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const reqA: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.1',
			headers: { 'user-agent': 'ua-a', 'accept-language': 'pt-BR' },
			socket: { remoteAddress: '127.0.0.1' },
		};
		const reqB: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.2',
			headers: { 'user-agent': 'ua-b', 'accept-language': 'pt-BR' },
			socket: { remoteAddress: '127.0.0.2' },
		};
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();

		for (let i = 0; i < 12; i += 1) {
			await middleware.use(reqA, res, next);
		}

		let thrown: unknown;
		try {
			await middleware.use(reqA, res, next);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
		await expect(middleware.use(reqB, res, next)).resolves.toBeUndefined();
	});

	it('applies a tight limit to POST:/leads/purchase-intent', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const req: any = {
			method: 'POST',
			path: '/leads/purchase-intent',
			ip: '127.0.0.1',
			headers: {
				'user-agent': 'jest',
				'accept-language': 'pt-BR',
			},
			socket: { remoteAddress: '127.0.0.1' },
		};
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();

		for (let i = 0; i < 5; i += 1) {
			await middleware.use(req, res, next);
		}

		expect(next).toHaveBeenCalledTimes(5);

		let thrown: unknown;
		try {
			await middleware.use(req, res, next);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
	});

	// Import de planilha da B3 tem :id no caminho; sem regra por padrão caía
	// no default de 300/min, e trocar o id abria um balde novo a cada chamada.
	it('limits B3 spreadsheet imports to 20 per 10 minutes, sharing one bucket across portfolio ids and routes', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();
		const reqFor = (path: string): any => ({
			method: 'POST',
			path,
			ip: '10.0.0.9',
			headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
			socket: { remoteAddress: '10.0.0.9' },
		});
		const paths = [
			'/portfolio/aaa/import-b3-auto',
			'/portfolio/bbb/import-b3',
			'/portfolio/ccc/import-b3-transactions',
		];

		for (let i = 0; i < 20; i += 1) {
			await middleware.use(reqFor(paths[i % paths.length]), res, next);
		}
		expect(next).toHaveBeenCalledTimes(20);

		await expect(
			middleware.use(reqFor('/portfolio/zzz/import-b3-auto'), res, next)
		).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
	});
});
