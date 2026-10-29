import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import { B3AccessTokenProvider } from './b3-access-token.provider';
import type {
	B3HttpRequest,
	B3HttpResponse,
	B3HttpTransport,
} from './b3-http.transport';

const CONFIG = {
	tokenUrl: 'https://login.example/token',
	clientId: 'client-id',
	clientSecret: 'client secret&x',
	scope: 'abc/.default',
};

function tokenTransport(
	responses: Array<{ status: number; data?: unknown } | Error>
) {
	const send = jest.fn<Promise<B3HttpResponse>, [B3HttpRequest]>(async () => {
		const next = responses.shift();
		if (!next) throw new Error('no more responses');
		if (next instanceof Error) throw next;
		return { status: next.status, data: next.data };
	});
	return { transport: { send } as B3HttpTransport, send };
}

describe('B3AccessTokenProvider', () => {
	it('requests a client_credentials token as a URL-encoded form', async () => {
		const { transport, send } = tokenTransport([
			{ status: 200, data: { access_token: 'tok-1', expires_in: 3599 } },
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		await expect(provider.getToken()).resolves.toBe('tok-1');

		const request = send.mock.calls[0][0];
		expect(request.method).toBe('POST');
		expect(request.url).toBe(CONFIG.tokenUrl);
		expect(request.headers).toEqual({
			'Content-Type': 'application/x-www-form-urlencoded',
		});
		const form = new URLSearchParams(request.body);
		expect(Object.fromEntries(form)).toEqual({
			grant_type: 'client_credentials',
			client_id: 'client-id',
			client_secret: 'client secret&x',
			scope: 'abc/.default',
		});
	});

	it('reuses the cached token until one minute before it expires', async () => {
		let now = 0;
		const { transport, send } = tokenTransport([
			{ status: 200, data: { access_token: 'tok-1', expires_in: 3599 } },
			{ status: 200, data: { access_token: 'tok-2', expires_in: 3599 } },
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG, () => now);

		await provider.getToken();
		now = 3599_000 - 61_000;
		await expect(provider.getToken()).resolves.toBe('tok-1');
		now = 3599_000 - 59_000;
		await expect(provider.getToken()).resolves.toBe('tok-2');
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('shares a single in-flight request between concurrent callers', async () => {
		const { transport, send } = tokenTransport([
			{ status: 200, data: { access_token: 'tok-1', expires_in: 3599 } },
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		const tokens = await Promise.all([
			provider.getToken(),
			provider.getToken(),
		]);

		expect(tokens).toEqual(['tok-1', 'tok-1']);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('fetches a new token after invalidate', async () => {
		const { transport } = tokenTransport([
			{ status: 200, data: { access_token: 'tok-1', expires_in: 3599 } },
			{ status: 200, data: { access_token: 'tok-2', expires_in: 3599 } },
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		await provider.getToken();
		provider.invalidate();

		await expect(provider.getToken()).resolves.toBe('tok-2');
	});

	it('fails with auth_failed when the token endpoint refuses', async () => {
		const { transport } = tokenTransport([
			{
				status: 401,
				data: { error: 'invalid_client', error_description: 'client-id' },
			},
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		const error = await provider.getToken().catch((e) => e);

		expect(error).toBeInstanceOf(B3InvestorError);
		expect(error.kind).toBe('auth_failed');
		expect(error.status).toBe(401);
		expect(error.message).not.toContain('client-id');
	});

	it('fails with auth_failed when the response has no access_token', async () => {
		const { transport } = tokenTransport([{ status: 200, data: {} }]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		await expect(provider.getToken()).rejects.toMatchObject({
			kind: 'auth_failed',
		});
	});

	it('maps a network error to unavailable and retries on the next call', async () => {
		const { transport } = tokenTransport([
			new Error('ECONNRESET'),
			{ status: 200, data: { access_token: 'tok-1', expires_in: 3599 } },
		]);
		const provider = new B3AccessTokenProvider(transport, CONFIG);

		const error = await provider.getToken().catch((e) => e);
		expect(error).toMatchObject({ kind: 'unavailable', retryable: true });
		await expect(provider.getToken()).resolves.toBe('tok-1');
	});
});
