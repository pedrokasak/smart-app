import {
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { AppleIdentityVerifierAdapter } from './apple-identity-verifier.adapter';

const AUDIENCE = 'br.com.trackerr.app';
const ISSUER = 'https://appleid.apple.com';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
	modulusLength: 2048,
});
const privatePem = privateKey
	.export({ type: 'pkcs8', format: 'pem' })
	.toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const jwks = {
	keys: [
		{ ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256' },
	],
};

const jwt = new JwtService({});

const sign = (claims: object = {}, options: object = {}) =>
	jwt.sign(
		{ sub: 'apple-sub', email: 'A@B.com', email_verified: 'true', ...claims },
		{
			privateKey: privatePem,
			algorithm: 'RS256',
			keyid: 'key-1',
			issuer: ISSUER,
			audience: AUDIENCE,
			expiresIn: '5m',
			...options,
		} as any
	);

describe('AppleIdentityVerifierAdapter', () => {
	const fetchMock = jest.fn();
	const originalFetch = global.fetch;
	const adapter = (audiences = [AUDIENCE]) =>
		new AppleIdentityVerifierAdapter(jwt, audiences);

	beforeEach(() => {
		global.fetch = fetchMock as any;
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true, json: async () => jwks });
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	it('aceita um token válido e normaliza o e-mail', async () => {
		await expect(adapter().verify(sign())).resolves.toEqual({
			sub: 'apple-sub',
			email: 'a@b.com',
			emailVerified: true,
		});
	});

	it('aceita email_verified booleano', async () => {
		const identity = await adapter().verify(sign({ email_verified: true }));

		expect(identity.emailVerified).toBe(true);
	});

	it('token sem e-mail segue válido: a Apple pode omitir depois do primeiro login', async () => {
		const token = jwt.sign({ sub: 'apple-sub' }, {
			privateKey: privatePem,
			algorithm: 'RS256',
			keyid: 'key-1',
			issuer: ISSUER,
			audience: AUDIENCE,
			expiresIn: '5m',
		} as any);

		await expect(adapter().verify(token)).resolves.toEqual({
			sub: 'apple-sub',
			email: undefined,
			emailVerified: false,
		});
	});

	it.each([
		['audiência de outro app', { audience: 'com.other.app' }],
		['outro emissor', { issuer: 'https://evil.example.com' }],
		['token expirado', { expiresIn: -10 }],
	])('recusa %s', async (_label, options) => {
		await expect(adapter().verify(sign({}, options))).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('recusa assinatura de outra chave com o mesmo kid', async () => {
		const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
		const token = sign(
			{},
			{
				privateKey: other.privateKey
					.export({ type: 'pkcs8', format: 'pem' })
					.toString(),
			}
		);

		await expect(adapter().verify(token)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('recusa HS256 assinado com a chave pública como segredo', async () => {
		const header = Buffer.from(
			JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'key-1' })
		).toString('base64url');
		const payload = Buffer.from(
			JSON.stringify({
				sub: 'attacker',
				iss: ISSUER,
				aud: AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 300,
			})
		).toString('base64url');
		const signature = crypto
			.createHmac('sha256', publicPem)
			.update(`${header}.${payload}`)
			.digest('base64url');

		await expect(
			adapter().verify(`${header}.${payload}.${signature}`)
		).rejects.toThrow(UnauthorizedException);
	});

	it('recusa token sem assinatura', async () => {
		const header = Buffer.from(
			JSON.stringify({ alg: 'none', kid: 'key-1' })
		).toString('base64url');
		const payload = Buffer.from(
			JSON.stringify({ sub: 'attacker', iss: ISSUER, aud: AUDIENCE })
		).toString('base64url');

		await expect(adapter().verify(`${header}.${payload}.`)).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('recusa texto que não é JWT', async () => {
		await expect(adapter().verify('not-a-jwt')).rejects.toThrow(
			UnauthorizedException
		);
	});

	it('sem audiência configurada, recusa sem buscar chaves', async () => {
		await expect(adapter([]).verify(sign())).rejects.toThrow(
			UnauthorizedException
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	describe('nonce', () => {
		it('aceita quando confere', async () => {
			await expect(
				adapter().verify(sign({ nonce: 'abc' }), 'abc')
			).resolves.toMatchObject({ sub: 'apple-sub' });
		});

		it('recusa token com nonce quando a requisição não envia nenhum', async () => {
			await expect(adapter().verify(sign({ nonce: 'abc' }))).rejects.toThrow(
				UnauthorizedException
			);
		});

		it.each([
			['diferente', { nonce: 'other' }],
			['ausente no token', {}],
		])('recusa %s', async (_label, claims) => {
			await expect(adapter().verify(sign(claims), 'abc')).rejects.toThrow(
				UnauthorizedException
			);
		});
	});

	describe('chaves da Apple', () => {
		it('reaproveita o cache entre logins', async () => {
			const verifier = adapter();

			await verifier.verify(sign());
			await verifier.verify(sign());

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('logins simultâneos com o cache frio fazem uma busca só', async () => {
			const verifier = adapter();

			await Promise.all([verifier.verify(sign()), verifier.verify(sign())]);

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('kid desconhecido não vira uma busca por requisição', async () => {
			const verifier = adapter();
			await verifier.verify(sign());

			await expect(
				verifier.verify(sign({}, { keyid: 'made-up' }))
			).rejects.toThrow(UnauthorizedException);
			await expect(
				verifier.verify(sign({}, { keyid: 'made-up-2' }))
			).rejects.toThrow(UnauthorizedException);

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('kid novo busca as chaves depois do intervalo mínimo', async () => {
			const verifier = adapter();
			await verifier.verify(sign());
			const later = Date.now() + 61_000;
			const now = jest.spyOn(Date, 'now').mockReturnValue(later);
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({
					keys: [{ ...jwks.keys[0], kid: 'key-2' }],
				}),
			});

			const token = sign({}, { keyid: 'key-2' });
			await verifier.verify(token).catch(() => undefined);
			now.mockRestore();

			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('sem cache e com a Apple fora do ar, responde indisponível', async () => {
			fetchMock.mockRejectedValue(new Error('network'));

			await expect(adapter().verify(sign())).rejects.toThrow(
				ServiceUnavailableException
			);
		});

		it('com cache e a Apple fora do ar, segue validando', async () => {
			const verifier = adapter();
			await verifier.verify(sign());
			const later = Date.now() + 25 * 60 * 60 * 1000;
			fetchMock.mockRejectedValue(new Error('network'));
			const token = sign({}, { expiresIn: '26h' });
			const now = jest.spyOn(Date, 'now').mockReturnValue(later);

			await expect(verifier.verify(token)).resolves.toMatchObject({
				sub: 'apple-sub',
			});
			now.mockRestore();
		});
	});
});
