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
		jwtService.verifyAsync.mockResolvedValue({
			userId: 'user-1',
			type: 'access',
		});
		const request: any = {
			path: '/portfolio',
			url: '/portfolio',
			headers: { authorization: 'Bearer token-valido' },
		};

		await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
		expect(request.user).toEqual({ userId: 'user-1', type: 'access' });
	});
});

describe('JwtAuthGuard — confusão de tipo de token', () => {
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

	function protectedRoute() {
		return contextFor({
			path: '/portfolio',
			url: '/portfolio',
			headers: { authorization: 'Bearer token' },
		});
	}

	// O tempToken do 2FA é assinado com o MESMO jwtSecret dos tokens de acesso
	// e é devolvido pelo /auth/signin a quem só apresentou a senha, antes do
	// segundo fator. Se o guard aceitasse esse token, quem tem a senha entraria
	// sem nunca informar o código TOTP — o 2FA viraria decoração.
	it('recusa o tempToken de 2FA numa rota protegida', async () => {
		jwtService.verifyAsync.mockResolvedValue({
			userId: 'user-1',
			type: 'temp_2fa',
		});

		await expect(guard.canActivate(protectedRoute())).rejects.toThrow(
			UnauthorizedException
		);
	});

	// O refresh token também é assinado com o mesmo segredo e vive muito mais
	// que o de acesso. Aceitá-lo como credencial de rota transformaria um token
	// de longa duração em acesso direto, sem passar pela rotação.
	it('recusa o refresh token numa rota protegida', async () => {
		jwtService.verifyAsync.mockResolvedValue({
			userId: 'user-1',
			type: 'refresh',
		});

		await expect(guard.canActivate(protectedRoute())).rejects.toThrow(
			UnauthorizedException
		);
	});

	// Falha fechada: token sem o claim `type` não é um token de acesso emitido
	// por este servidor. Aceitar por omissão reabriria a porta para qualquer
	// token futuro que esquecesse de se identificar.
	it('recusa token sem o claim type', async () => {
		jwtService.verifyAsync.mockResolvedValue({ userId: 'user-1' });

		await expect(guard.canActivate(protectedRoute())).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('aceita o token de acesso legítimo', async () => {
		const request: any = {
			path: '/portfolio',
			url: '/portfolio',
			headers: { authorization: 'Bearer token' },
		};
		jwtService.verifyAsync.mockResolvedValue({
			userId: 'user-1',
			type: 'access',
			role: 'user',
		});

		await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
		expect(request.user.userId).toBe('user-1');
	});
});
