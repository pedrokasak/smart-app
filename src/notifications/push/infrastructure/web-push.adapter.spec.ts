import * as webpush from 'web-push';
import { WebPushAdapter } from './web-push.adapter';
import { DisabledWebPushAdapter } from './disabled-web-push.adapter';
import { WebPushSender } from '../application/ports/web-push-sender.port';
import { readVapidConfig } from './vapid.config';
import { WebPushPayload } from '../domain/push.types';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

const sendNotification = webpush.sendNotification as unknown as jest.Mock;

const CONFIG = {
	publicKey: 'BPUBLIC',
	privateKey: 'PRIVATE',
	subject: 'mailto:contato@trackerr.app',
};

const TARGET = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
	keys: { p256dh: 'p256dh-valor', auth: 'auth-valor' },
};

const PAYLOAD: WebPushPayload = {
	title: 'Trakker',
	body: '3 novidades na sua carteira',
	tag: 'trackerr-daily-2026-03-10',
	url: '/dashboard',
	count: 3,
};

/** Reproduz o formato do erro que a lib lanca em resposta HTTP. */
function httpError(statusCode: number): Error {
	const err = new Error(`Received unexpected response code ${statusCode}`);
	(err as any).statusCode = statusCode;
	return err;
}

// O mock de `web-push` e de modulo, entao a limpeza precisa ser de arquivo:
// dentro de um describe ela nao alcanca os blocos seguintes, e o ultimo envio
// de um bloco vaza como chamada registrada no proximo.
beforeEach(() => jest.clearAllMocks());

describe('WebPushAdapter', () => {
	const adapter = new WebPushAdapter(CONFIG);

	it('entrega passando as credenciais VAPID por chamada, sem estado global', async () => {
		sendNotification.mockResolvedValue({ statusCode: 201 });

		await expect(adapter.send(TARGET, PAYLOAD)).resolves.toEqual({
			outcome: 'sent',
		});

		const [subscription, body, options] = sendNotification.mock.calls[0];
		expect(subscription.endpoint).toBe(TARGET.endpoint);
		expect(JSON.parse(body)).toEqual(PAYLOAD);
		expect(options.vapidDetails.publicKey).toBe('BPUBLIC');
		expect(options.TTL).toBeGreaterThan(0);
	});

	it.each([404, 410])(
		'HTTP %i marca a assinatura como morta (permanente)',
		async (statusCode) => {
			sendNotification.mockRejectedValue(httpError(statusCode));

			await expect(adapter.send(TARGET, PAYLOAD)).resolves.toEqual({
				outcome: 'expired',
				statusCode,
			});
		}
	);

	it.each([429, 500, 502, 503, 504])(
		'HTTP %i e falha PASSAGEIRA — a assinatura continua valida',
		async (statusCode) => {
			sendNotification.mockRejectedValue(httpError(statusCode));

			const result = await adapter.send(TARGET, PAYLOAD);

			expect(result.outcome).toBe('transient');
		}
	);

	it('falha de rede (sem statusCode) tambem e passageira', async () => {
		sendNotification.mockRejectedValue(new Error('ETIMEDOUT'));

		const result = await adapter.send(TARGET, PAYLOAD);

		expect(result.outcome).toBe('transient');
	});

	it.each([400, 401, 403, 413])(
		'HTTP %i e problema nosso: nao entrega, mas tambem nao apaga a assinatura',
		async (statusCode) => {
			sendNotification.mockRejectedValue(httpError(statusCode));

			const result = await adapter.send(TARGET, PAYLOAD);

			expect(result.outcome).toBe('invalid');
		}
	);

	it('barra payload acima do teto antes de gastar uma viagem de rede', async () => {
		const gigante: WebPushPayload = { ...PAYLOAD, body: 'x'.repeat(5000) };

		const result = await adapter.send(TARGET, gigante);

		expect(result.outcome).toBe('invalid');
		expect(sendNotification).not.toHaveBeenCalled();
	});

	it('nunca deixa as chaves da assinatura vazarem no erro devolvido', async () => {
		sendNotification.mockRejectedValue(httpError(500));

		const result = await adapter.send(TARGET, PAYLOAD);

		expect(JSON.stringify(result)).not.toContain(TARGET.keys.auth);
		expect(JSON.stringify(result)).not.toContain(TARGET.keys.p256dh);
	});
});

describe('sem chaves VAPID configuradas', () => {
	it('readVapidConfig devolve null quando o par nao esta no ambiente', () => {
		expect(readVapidConfig()).toBeNull();
	});

	it('o null object nao envia nada e nao explode', async () => {
		// Tipado pela porta de proposito: e assim que o resto do sistema chama,
		// e garante que a implementacao vazia continua satisfazendo o contrato.
		const disabled: WebPushSender = new DisabledWebPushAdapter();

		expect(disabled.isEnabled()).toBe(false);
		expect(disabled.publicKey()).toBe('');
		await expect(disabled.send(TARGET, PAYLOAD)).resolves.toEqual({
			outcome: 'disabled',
		});
		expect(sendNotification).not.toHaveBeenCalled();
	});
});
