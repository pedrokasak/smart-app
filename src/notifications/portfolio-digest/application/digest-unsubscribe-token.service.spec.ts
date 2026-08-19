import { JwtService } from '@nestjs/jwt';
import { DigestUnsubscribeTokenService } from './digest-unsubscribe-token.service';

describe('DigestUnsubscribeTokenService', () => {
	let service: DigestUnsubscribeTokenService;
	let jwtService: JwtService;

	beforeEach(() => {
		jwtService = new JwtService({});
		service = new DigestUnsubscribeTokenService(jwtService);
	});

	it('assina e verifica um token válido, devolvendo o userId', () => {
		const token = service.sign('user-123');

		const result = service.verify(token);

		expect(result).toEqual({ userId: 'user-123' });
	});

	it('rejeita token assinado com o secret de autenticação (JWT_SECRET), não o de digest', () => {
		// Simula um access token de login: mesmo formato, secret diferente.
		const authToken = jwtService.sign(
			{ userId: 'user-123', type: 'access' },
			{ secret: 'test-secret' } // JWT_SECRET do ambiente de teste
		);

		const result = service.verify(authToken);

		expect(result).toBeNull();
	});

	it('rejeita token com purpose diferente, mesmo assinado com o secret certo', () => {
		const tokenWithWrongPurpose = jwtService.sign(
			{ userId: 'user-123', purpose: 'something_else' },
			{ secret: 'test-digest-secret' }
		);

		const result = service.verify(tokenWithWrongPurpose);

		expect(result).toBeNull();
	});

	it('rejeita token malformado', () => {
		expect(service.verify('not-a-jwt')).toBeNull();
		expect(service.verify('')).toBeNull();
	});

	it('rejeita token expirado', () => {
		const expiredToken = jwtService.sign(
			{ userId: 'user-123', purpose: 'portfolio_digest_unsubscribe' },
			{ secret: 'test-digest-secret', expiresIn: '-1s' }
		);

		const result = service.verify(expiredToken);

		expect(result).toBeNull();
	});
});
