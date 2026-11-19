import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EndpointRateLimitMiddleware } from './endpoint-rate-limit.middleware';

describe('Rate limit para o app', () => {
	const jwt = new JwtService({ secret: 'spec-secret' });
	const accessToken = (userId: string) => jwt.sign({ userId, type: 'access' });

	const request = (overrides: object) =>
		({
			method: 'GET',
			path: '/mobile/v1/home',
			ip: '10.0.0.1',
			headers: { 'user-agent': 'Trackerr/1.0', 'accept-language': 'pt-BR' },
			...overrides,
		}) as any;
	const response = { setHeader: jest.fn() } as any;

	/** Quantas requisições passam antes do 429. */
	const allowedUntilBlocked = async (
		middleware: EndpointRateLimitMiddleware,
		req: any,
		attempts: number
	) => {
		let allowed = 0;
		for (let i = 0; i < attempts; i += 1) {
			try {
				await middleware.use(req, response, jest.fn());
				allowed += 1;
			} catch (error) {
				expect((error as HttpException).getStatus()).toBe(429);
				break;
			}
		}
		return allowed;
	};

	const auth = (token: string) => ({
		headers: {
			'user-agent': 'Trackerr/1.0',
			'accept-language': 'pt-BR',
			authorization: `Bearer ${token}`,
		},
	});

	it('pessoas diferentes no mesmo IP e user-agent têm contadores próprios', async () => {
		const middleware = new EndpointRateLimitMiddleware(undefined, jwt);

		expect(
			await allowedUntilBlocked(
				middleware,
				request(auth(accessToken('ana'))),
				400
			)
		).toBe(30);
		expect(
			await allowedUntilBlocked(
				middleware,
				request(auth(accessToken('bia'))),
				1
			)
		).toBe(1);
	});

	it('a mesma pessoa não escapa do limite trocando de IP', async () => {
		const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
		const token = accessToken('ana');
		await allowedUntilBlocked(middleware, request(auth(token)), 300);

		expect(
			await allowedUntilBlocked(
				middleware,
				request({ ...auth(token), ip: '10.9.9.9' }),
				1
			)
		).toBe(0);
	});

	it('token forjado não escolhe contador: conta pelo cliente', async () => {
		const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
		const forged = new JwtService({ secret: 'other' }).sign({
			userId: 'x',
			type: 'access',
		});
		await allowedUntilBlocked(middleware, request(auth(forged)), 300);
		const otherForged = new JwtService({ secret: 'other' }).sign({
			userId: 'y',
			type: 'access',
		});

		expect(
			await allowedUntilBlocked(middleware, request(auth(otherForged)), 1)
		).toBe(0);
	});

	it('token que não é de acesso não vale como conta', async () => {
		const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
		const temp = (userId: string) => jwt.sign({ userId, type: 'temp_2fa' });
		await allowedUntilBlocked(middleware, request(auth(temp('a'))), 300);

		expect(
			await allowedUntilBlocked(middleware, request(auth(temp('b'))), 1)
		).toBe(0);
	});

	it('fora do BFF, o token não muda o contador', async () => {
		const middleware = new EndpointRateLimitMiddleware(undefined, jwt);
		const path = '/portfolio/summary';
		await allowedUntilBlocked(
			middleware,
			request({ ...auth(accessToken('ana')), path }),
			300
		);

		expect(
			await allowedUntilBlocked(
				middleware,
				request({ ...auth(accessToken('bia')), path }),
				1
			)
		).toBe(0);
	});

	it('fora do login, um deviceId novo não abre contador novo', async () => {
		const middleware = new EndpointRateLimitMiddleware();
		const portal = (deviceId: string) =>
			request({
				method: 'POST',
				path: '/subscription/portal',
				body: { device: { deviceId }, tempToken: deviceId },
			});
		for (let i = 0; i < 20; i += 1) {
			await middleware.use(portal(`device-${i}`), response, jest.fn());
		}

		await expect(
			middleware.use(portal('another'), response, jest.fn())
		).rejects.toThrow(HttpException);
	});

	describe('login', () => {
		const signin = (body: object) =>
			request({ method: 'POST', path: '/auth/signin', body });

		it('aparelhos diferentes no mesmo IP não dividem o limite', async () => {
			const middleware = new EndpointRateLimitMiddleware();
			const first = { device: { deviceId: 'phone-1' } };

			expect(await allowedUntilBlocked(middleware, signin(first), 20)).toBe(12);
			expect(
				await allowedUntilBlocked(
					middleware,
					signin({ device: { deviceId: 'phone-2' } }),
					1
				)
			).toBe(1);
		});

		it('trocar o e-mail tentado não abre contador novo', async () => {
			const middleware = new EndpointRateLimitMiddleware();
			for (let i = 0; i < 12; i += 1) {
				await middleware.use(
					signin({ email: `vitima${i}@x.com` }),
					response,
					jest.fn()
				);
			}

			await expect(
				middleware.use(signin({ email: 'outra@x.com' }), response, jest.fn())
			).rejects.toThrow(HttpException);
		});

		it('deviceId fora do formato não quebra', async () => {
			const middleware = new EndpointRateLimitMiddleware();

			await expect(
				middleware.use(
					signin({ device: { deviceId: 123 } }),
					response,
					jest.fn()
				)
			).resolves.toBeUndefined();
			await expect(
				middleware.use(signin({ device: 'x' }), response, jest.fn())
			).resolves.toBeUndefined();
		});
	});
});
