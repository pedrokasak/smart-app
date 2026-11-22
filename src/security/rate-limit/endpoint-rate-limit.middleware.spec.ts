import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

	// TRA-238: cada resumo de RI novo baixa um PDF e chama o LLM.
	it('limits RI AI summaries to 20 per 10 minutes', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const res: any = { setHeader: jest.fn() };
		const next = jest.fn();
		const req: any = {
			method: 'POST',
			path: '/ri-intelligence/summary',
			ip: '10.0.0.7',
			headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
			socket: { remoteAddress: '10.0.0.7' },
		};

		for (let i = 0; i < 20; i += 1) {
			await middleware.use(req, res, next);
		}
		expect(next).toHaveBeenCalledTimes(20);

		await expect(middleware.use(req, res, next)).rejects.toMatchObject({
			status: HttpStatus.TOO_MANY_REQUESTS,
		});
	});

	describe('advisor invite routes', () => {
		const requestTo = (method: string, path: string): any => ({
			method,
			path,
			ip: '127.0.0.9',
			headers: { 'user-agent': 'jest', 'accept-language': 'pt-BR' },
			socket: { remoteAddress: '127.0.0.9' },
		});

		const allowedBeforeBlock = async (
			middleware: EndpointRateLimitMiddleware,
			req: any
		): Promise<number> => {
			const res: any = { setHeader: jest.fn() };
			const next = jest.fn();
			for (let i = 0; i < 400; i += 1) {
				try {
					await middleware.use(req, res, next);
				} catch (error) {
					expect((error as HttpException).getStatus()).toBe(
						HttpStatus.TOO_MANY_REQUESTS
					);
					return next.mock.calls.length;
				}
			}
			return next.mock.calls.length;
		};

		it.each([
			['GET', '/me/advisor-access/invites/preview'],
			['POST', '/me/advisor-access/invites/accept'],
			['POST', '/me/advisor-access/invites/decline'],
			['GET', '/me/advisor-access/invites/preview/'],
			['POST', '/me/advisor-access/invites/accept/'],
			['POST', '/me/advisor-access/invites/decline/'],
		])('%s %s allows 5 per minute', async (method, path) => {
			const middleware = new EndpointRateLimitMiddleware();
			expect(
				await allowedBeforeBlock(middleware, requestTo(method, path))
			).toBe(5);
		});

		it('counts the path with and without a trailing slash in one bucket', async () => {
			const middleware = new EndpointRateLimitMiddleware();
			const path = '/me/advisor-access/invites/accept';
			for (let i = 0; i < 3; i += 1) {
				await middleware.use(requestTo('POST', path), {} as any, jest.fn());
			}
			expect(
				await allowedBeforeBlock(middleware, requestTo('POST', `${path}/`))
			).toBe(2);
		});

		it('keeps the existing limits of other routes', async () => {
			const middleware = new EndpointRateLimitMiddleware();
			expect(
				await allowedBeforeBlock(middleware, requestTo('POST', '/auth/signin'))
			).toBe(12);
			expect(
				await allowedBeforeBlock(
					middleware,
					requestTo('GET', '/me/advisor-access')
				)
			).toBe(300);
		});
	});
	describe('advisor BFF routes', () => {
		const jwt = new JwtService({ secret: 'spec-secret' });
		const token = (userId: string) => jwt.sign({ userId, type: 'access' });
		const requestAs = (
			method: string,
			path: string,
			opts: { token?: string; ip?: string } = {}
		): any => ({
			method,
			path,
			ip: opts.ip ?? '10.0.0.1',
			headers: {
				'user-agent': 'jest',
				'accept-language': 'pt-BR',
				...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
			},
			socket: { remoteAddress: opts.ip ?? '10.0.0.1' },
		});
		const res: any = { setHeader: jest.fn() };

		const allowedBeforeBlock = async (
			middleware: EndpointRateLimitMiddleware,
			build: (attempt: number) => any,
			max = 400
		): Promise<number> => {
			const next = jest.fn();
			for (let i = 0; i < max; i += 1) {
				try {
					await middleware.use(build(i), res, next);
				} catch (error) {
					expect((error as HttpException).getStatus()).toBe(
						HttpStatus.TOO_MANY_REQUESTS
					);
					return next.mock.calls.length;
				}
			}
			return next.mock.calls.length;
		};

		const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

		it('blocks the 11th invite of one account even when the IP changes', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs('POST', '/advisor/v1/invites', {
						token: ana,
						ip: `10.0.1.${i}`,
					})
				)
			).toBe(10);
		});

		it('shares the IP bucket between two accounts on the same IP', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			const bia = token('bia');
			await allowedBeforeBlock(middleware, () =>
				requestAs('POST', '/advisor/v1/invites', { token: ana })
			);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites', { token: bia })
				)
			).toBe(0);
		});

		it('counts by client when the token is invalid or forged', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const forged = (id: string) =>
				new JwtService({ secret: 'other' }).sign({
					userId: id,
					type: 'access',
				});
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites', { token: forged('x') })
				)
			).toBe(10);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites', { token: forged('y') })
				)
			).toBe(0);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites/', { token: 'garbage' })
				)
			).toBe(0);
		});

		it('falls back to the IP bucket for an expired access token and a refresh token', async () => {
			const expired = jwt.sign(
				{ userId: 'ana', type: 'access' },
				{ expiresIn: -1 }
			);
			const refresh = jwt.sign({ userId: 'bia', type: 'refresh' });
			for (const bad of [expired, refresh]) {
				const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
				expect(
					await allowedBeforeBlock(middleware, () =>
						requestAs('POST', '/advisor/v1/invites', { token: bad })
					)
				).toBe(10);
				// A valid token of another account on the same IP is blocked by
				// the IP bucket, proving the bad token was counted by IP.
				expect(
					await allowedBeforeBlock(middleware, () =>
						requestAs('POST', '/advisor/v1/invites', { token: token('cy') })
					)
				).toBe(0);
			}
		});

		it('also counts an authenticated advisor request by IP', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			let n = 0;
			// Many accounts on one IP: the IP bucket stops them at 10 in total.
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites', {
						token: token(`user-${n++}`),
					})
				)
			).toBe(10);
		});

		it('keeps the account bucket when one account changes IP', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			let n = 0;
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', '/advisor/v1/invites', {
						token: ana,
						ip: `10.0.2.${n++}`,
					})
				)
			).toBe(10);
		});

		it('counts mobile requests by account only, not by IP', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			let n = 0;
			expect(
				await allowedBeforeBlock(
					middleware,
					() =>
						requestAs('GET', '/mobile/v1/home', {
							token: token(`user-${n++}`),
						}),
					40
				)
			).toBe(40);
		});

		it('ignores the case of the path for pattern and fallback keys', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			const paths = [
				'/advisor/v1/invites',
				'/advisor/v1/INVITES',
				'/Advisor/V1/Invites/',
			];
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs('POST', paths[i % 3], { token: ana })
				)
			).toBe(10);

			const anon = new EndpointRateLimitMiddleware();
			const signin = ['/auth/signin', '/AUTH/SignIn', '/auth/SIGNIN'];
			expect(
				await allowedBeforeBlock(anon, (i) => requestAs('POST', signin[i % 3]))
			).toBe(12);
		});

		it('answers 429 with the BFF error body and Retry-After under /advisor/v1', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const setHeader = jest.fn();
			const ana = token('ana');
			let thrown: HttpException | undefined;
			for (let i = 0; i < 11 && !thrown; i += 1) {
				try {
					await middleware.use(
						requestAs('POST', '/advisor/v1/invites', { token: ana }),
						{ setHeader } as any,
						jest.fn()
					);
				} catch (error) {
					thrown = error as HttpException;
				}
			}
			expect(thrown?.getStatus()).toBe(429);
			expect(thrown?.getResponse()).toEqual({
				statusCode: 429,
				error: 'TOO_MANY_REQUESTS',
			});
			expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
		});

		it('keeps the plain message body outside /advisor/v1', async () => {
			const middleware = new EndpointRateLimitMiddleware();
			let thrown: HttpException | undefined;
			for (let i = 0; i < 13 && !thrown; i += 1) {
				try {
					await middleware.use(
						requestAs('POST', '/auth/signin'),
						res,
						jest.fn()
					);
				} catch (error) {
					thrown = error as HttpException;
				}
			}
			expect(typeof thrown?.getResponse()).toBe('string');
		});

		it.each([
			['POST', '/advisor/v1/organizations', 5],
			['POST', '/advisor/v1/organizations/', 5],
			['POST', '/advisor/v1/invites', 10],
			['POST', '/advisor/v1/invites/', 10],
			['POST', `/advisor/v1/invites/${ID_A}/resend`, 10],
			['POST', `/advisor/v1/invites/${ID_A}/resend/`, 10],
			['POST', `/advisor/v1/clients/${ID_A}/imports`, 20],
			['POST', `/advisor/v1/clients/${ID_A}/imports/`, 20],
			['POST', '/advisor/v1/member-invites', 10],
			['POST', '/advisor/v1/member-invites/', 10],
			['POST', `/advisor/v1/member-invites/${ID_A}/resend`, 10],
			['POST', `/advisor/v1/member-invites/${ID_A}/resend/`, 10],
			['POST', '/advisor/v1/me/member-invites/preview', 5],
			['POST', '/advisor/v1/me/member-invites/preview/', 5],
			['POST', '/advisor/v1/me/member-invites/accept', 5],
			['POST', '/advisor/v1/me/member-invites/accept/', 5],
			['POST', '/advisor/v1/me/member-invites/decline', 5],
			['POST', '/advisor/v1/me/member-invites/decline/', 5],
		])('%s %s allows %i per account', async (method, path, limit) => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs(method, path, { token: ana })
				)
			).toBe(limit);
		});

		it('shares one bucket across different ids of the same pattern', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs(
						'POST',
						`/advisor/v1/invites/aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}/resend`,
						{ token: ana }
					)
				)
			).toBe(10);
		});

		it('blocks the 6th member invite accept in a minute, per account and per IP', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const path = '/advisor/v1/me/member-invites/accept';
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs('POST', path, { token: ana, ip: `10.0.2.${i}` })
				)
			).toBe(5);
			// Outra conta no mesmo IP, e a mesma conta com a barra final.
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs('POST', path, { token: token(`u${i}`), ip: '10.0.3.1' })
				)
			).toBe(5);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('POST', `${path}/`, { token: ana, ip: '10.0.4.1' })
				)
			).toBe(0);
		});

		it('shares one bucket across different member invite ids on resend', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, (i) =>
					requestAs(
						'POST',
						`/advisor/v1/member-invites/aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}/resend`,
						{ token: ana }
					)
				)
			).toBe(10);
		});

		it('does not limit other methods or routes below the default', async () => {
			const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
			const ana = token('ana');
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('GET', '/advisor/v1/invites', { token: ana })
				)
			).toBe(300);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('DELETE', `/advisor/v1/invites/${ID_A}`, { token: ana })
				)
			).toBe(300);
			expect(
				await allowedBeforeBlock(middleware, () =>
					requestAs('GET', '/advisor/v1/member-invites', { token: ana })
				)
			).toBe(300);
		});
	});
});
