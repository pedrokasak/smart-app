import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

jest.mock('../env', () => ({ jwtSecret: 'test-secret' }));

function contextFor(request: any): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => request }),
		getHandler: () => undefined,
		getClass: () => undefined,
	} as unknown as ExecutionContext;
}

describe('JwtAuthGuard — isenção da rota de webhook (TRA-89)', () => {
	let guard: JwtAuthGuard;
	let jwtService: { verifyAsync: jest.Mock };
	let reflector: { getAllAndOverride: jest.Mock };
	let blacklist: { isBlacklisted: jest.Mock };

	beforeEach(() => {
		jwtService = { verifyAsync: jest.fn() };
		reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
		blacklist = { isBlacklisted: jest.fn().mockResolvedValue(false) };
		guard = new JwtAuthGuard(
			jwtService as any,
			reflector as any,
			blacklist as any
		);
	});

	it('libera a rota real do webhook do Stripe sem token', async () => {
		const context = contextFor({
			path: '/webhooks/stripe',
			url: '/webhooks/stripe',
			headers: {},
		});

		await expect(guard.canActivate(context)).resolves.toBe(true);
	});

	it('não deixa a query string virar isenção de autenticação', async () => {
		// Regressão do bypass: `request.url.includes('/webhooks/stripe')` casava
		// aqui e liberava qualquer rota para quem nem tem conta.
		const context = contextFor({
			path: '/portfolio/507f1f77bcf86cd799439011',
			url: '/portfolio/507f1f77bcf86cd799439011?x=/webhooks/stripe',
			headers: {},
		});

		await expect(guard.canActivate(context)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('não deixa o path apenas conter a rota do webhook', async () => {
		const context = contextFor({
			path: '/evil/webhooks/stripe/drain',
			url: '/evil/webhooks/stripe/drain',
			headers: {},
		});

		await expect(guard.canActivate(context)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('exige token válido numa rota comum', async () => {
		jwtService.verifyAsync.mockResolvedValue({ userId: 'user-1' });
		const request: any = {
			path: '/portfolio',
			url: '/portfolio',
			headers: { authorization: 'Bearer token-valido' },
		};

		await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
		expect(request.user).toEqual({ userId: 'user-1' });
	});
});
