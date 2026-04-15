import { HttpException, HttpStatus } from '@nestjs/common';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';

describe('EndpointRateLimitMiddleware', () => {
	it('allows requests below the configured limit', () => {
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
			middleware.use(req, res, next);
		}

		expect(next).toHaveBeenCalledTimes(12);
	});

	it('blocks when requests exceed route+fingerprint limit', () => {
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
			middleware.use(req, res, next);
		}

		let thrown: unknown;
		try {
			middleware.use(req, res, next);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
		expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
	});

	it('keeps independent buckets for different fingerprints', () => {
		const middleware = new EndpointRateLimitMiddleware();
		const reqA: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.1',
			headers: {'user-agent': 'ua-a', 'accept-language': 'pt-BR'},
			socket: {remoteAddress: '127.0.0.1'},
		};
		const reqB: any = {
			method: 'POST',
			path: '/auth/signin',
			ip: '127.0.0.2',
			headers: {'user-agent': 'ua-b', 'accept-language': 'pt-BR'},
			socket: {remoteAddress: '127.0.0.2'},
		};
		const res: any = {setHeader: jest.fn()};
		const next = jest.fn();

		for (let i = 0; i < 12; i += 1) {
			middleware.use(reqA, res, next);
		}

		let thrown: unknown;
		try {
			middleware.use(reqA, res, next);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HttpException);
		expect((thrown as HttpException).getStatus()).toBe(
			HttpStatus.TOO_MANY_REQUESTS
		);
		expect(() => middleware.use(reqB, res, next)).not.toThrow();
	});
});
