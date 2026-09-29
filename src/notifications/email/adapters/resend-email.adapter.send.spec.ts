import { ResendEmailAdapter } from './resend-email.adapter';

/**
 * TRA-261. O aviso de fato relevante e o primeiro envio em rajada: centenas
 * de jobs na fila, 20 por vez, contra o limite de 10 requisicoes/s do
 * Resend. O 429 virava entrega `failed`, sem nova tentativa.
 */

const sendMock = jest.fn();

jest.mock('resend', () => ({
	Resend: jest.fn().mockImplementation(() => ({
		domains: { list: jest.fn() },
		emails: { send: sendMock },
	})),
}));

const MESSAGE = { to: 'x@y.com', subject: 's', html: '<p>h</p>' };

const rateLimited = (retryAfter: string | null = '1') => ({
	data: null,
	error: {
		name: 'rate_limit_exceeded',
		message: 'Too many requests',
		statusCode: 429,
	},
	headers: retryAfter === null ? null : { 'retry-after': retryAfter },
});

const sent = { data: { id: 'email-1' }, error: null, headers: null };

describe('ResendEmailAdapter — ritmo de envio (TRA-261)', () => {
	const TOUCHED_KEYS = ['RESEND_API_KEY', 'RESEND_FROM'] as const;
	const envBackup = new Map<string, string | undefined>();

	beforeEach(() => {
		jest.clearAllMocks();
		for (const key of TOUCHED_KEYS) envBackup.set(key, process.env[key]);
		process.env.RESEND_API_KEY = 're_fake_key';
		process.env.RESEND_FROM = 'no-reply@trackerr.com.br';
	});

	afterEach(() => {
		for (const key of TOUCHED_KEYS) {
			const original = envBackup.get(key);
			if (original === undefined) delete process.env[key];
			else process.env[key] = original;
		}
		envBackup.clear();
	});

	function buildAdapter() {
		const adapter = new ResendEmailAdapter();
		for (const level of ['log', 'warn', 'error'] as const) {
			jest
				.spyOn((adapter as any).logger, level)
				.mockImplementation(() => undefined);
		}
		const wait = jest
			.spyOn(adapter as any, 'wait')
			.mockResolvedValue(undefined as never);
		return { adapter, wait };
	}

	it('waits for retry-after and tries again on 429', async () => {
		const { adapter, wait } = buildAdapter();
		sendMock
			.mockResolvedValueOnce(rateLimited('2'))
			.mockResolvedValueOnce(sent);

		await expect(adapter.send(MESSAGE)).resolves.toBeUndefined();

		expect(sendMock).toHaveBeenCalledTimes(2);
		expect(wait).toHaveBeenCalledWith(2000);
	});

	it('backs off on its own when the 429 has no retry-after', async () => {
		const { adapter, wait } = buildAdapter();
		sendMock
			.mockResolvedValueOnce(rateLimited(null))
			.mockResolvedValueOnce(rateLimited(null))
			.mockResolvedValueOnce(sent);

		await adapter.send(MESSAGE);

		expect(wait).toHaveBeenCalledWith(1000);
		expect(wait).toHaveBeenCalledWith(2000);
	});

	it('gives up after a few 429s instead of holding the job forever', async () => {
		const { adapter } = buildAdapter();
		sendMock.mockResolvedValue(rateLimited('1'));

		await expect(adapter.send(MESSAGE)).rejects.toThrow('Email send failed');

		expect(sendMock).toHaveBeenCalledTimes(4);
	});

	it('does not retry other errors', async () => {
		const { adapter } = buildAdapter();
		sendMock.mockResolvedValue({
			data: null,
			error: {
				name: 'validation_error',
				message: 'bad to',
				statusCode: 422,
			},
			headers: null,
		});

		await expect(adapter.send(MESSAGE)).rejects.toThrow('Email send failed');

		expect(sendMock).toHaveBeenCalledTimes(1);
	});

	it('spaces back-to-back sends under the provider limit', async () => {
		const { adapter, wait } = buildAdapter();
		sendMock.mockResolvedValue(sent);

		await Promise.all([adapter.send(MESSAGE), adapter.send(MESSAGE)]);

		// O segundo envio espera a vez: no maximo 125ms (8 por segundo).
		const waits = wait.mock.calls.map(([ms]) => ms as number);
		expect(waits).toHaveLength(1);
		expect(waits[0]).toBeGreaterThan(0);
		expect(waits[0]).toBeLessThanOrEqual(125);
	});
});
