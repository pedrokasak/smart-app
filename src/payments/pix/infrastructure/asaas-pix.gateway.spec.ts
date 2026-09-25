import { PixGatewayError } from 'src/payments/pix/application/pix-gateway.port';
import { AsaasPixGateway } from './asaas-pix.gateway';

type Call = { url: string; init: RequestInit };

function fakeFetch(
	responses: Array<{ status: number; body: unknown } | Error>
): { fetchFn: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const fetchFn = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const next = responses.shift();
		if (!next) throw new Error('resposta não configurada');
		if (next instanceof Error) throw next;
		return new Response(JSON.stringify(next.body), { status: next.status });
	}) as unknown as typeof fetch;
	return { fetchFn, calls };
}

const KEY = '$aact_hmlg_chave_de_teste';

describe('AsaasPixGateway (TRA-195)', () => {
	it.each([
		['https://api-sandbox.asaas.com/', 'https://api-sandbox.asaas.com/v3'],
		['https://api-sandbox.asaas.com', 'https://api-sandbox.asaas.com/v3'],
		['https://api.asaas.com/v3/', 'https://api.asaas.com/v3'],
	])('normaliza a base %p', (raw, expected) => {
		expect(AsaasPixGateway.normalizeBaseUrl(raw)).toBe(expected);
	});

	it('cria cliente com CPF, referência e notificações do Asaas desligadas', async () => {
		const { fetchFn, calls } = fakeFetch([
			{ status: 200, body: { id: 'cus_1' } },
		]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://api-sandbox.asaas.com/' },
			fetchFn
		);

		await expect(
			gateway.createCustomer({
				name: 'Ana',
				email: 'ana@x.com',
				cpf: '52998224725',
				externalReference: 'user-1',
			})
		).resolves.toBe('cus_1');

		expect(calls[0].url).toBe('https://api-sandbox.asaas.com/v3/customers');
		expect(calls[0].init.method).toBe('POST');
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.access_token).toBe(KEY);
		expect(headers['User-Agent']).toBeTruthy();
		expect(JSON.parse(String(calls[0].init.body))).toEqual({
			name: 'Ana',
			email: 'ana@x.com',
			cpfCnpj: '52998224725',
			externalReference: 'user-1',
			notificationDisabled: true,
		});
	});

	it('cria cobrança com billingType PIX', async () => {
		const { fetchFn, calls } = fakeFetch([
			{ status: 200, body: { id: 'pay_1' } },
		]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://x/v3' },
			fetchFn
		);

		await expect(
			gateway.createCharge({
				customerId: 'cus_1',
				value: 14.9,
				dueDate: '2026-09-25',
				description: 'Trackerr Pro · mensal',
				externalReference: 'charge-1',
			})
		).resolves.toEqual({ paymentId: 'pay_1' });
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
			customer: 'cus_1',
			billingType: 'PIX',
			value: 14.9,
			dueDate: '2026-09-25',
			externalReference: 'charge-1',
		});
	});

	it('lê o QR e converte a expiração de Brasília para UTC', async () => {
		const { fetchFn, calls } = fakeFetch([
			{
				status: 200,
				body: {
					success: true,
					encodedImage: 'iVBOR',
					payload: '00020126...',
					expirationDate: '2026-09-25 23:59:59',
				},
			},
		]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://x' },
			fetchFn
		);

		const qr = await gateway.getQrCode('pay_1');

		expect(calls[0].url).toBe('https://x/v3/payments/pay_1/pixQrCode');
		expect(qr.payload).toBe('00020126...');
		expect(qr.encodedImage).toBe('iVBOR');
		expect(qr.expiresAt.toISOString()).toBe('2026-09-26T02:59:59.000Z');
	});

	it('erro do Asaas vira mensagem nossa: nem a descrição do provedor nem a chave vazam', async () => {
		const { fetchFn } = fakeFetch([
			{
				status: 400,
				body: {
					errors: [
						{
							code: 'invalid_cpfCnpj',
							description: 'O CPF informado é inválido.',
						},
					],
				},
			},
		]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://x' },
			fetchFn
		);

		const error = await gateway
			.createCustomer({
				name: 'a',
				email: 'a@a',
				cpf: '1',
				externalReference: 'u',
			})
			.catch((e) => e);

		expect(error).toBeInstanceOf(PixGatewayError);
		expect(error.providerStatus).toBe(400);
		expect(error.message).not.toContain('invalid_cpfCnpj');
		expect(error.message).not.toContain(KEY);
	});

	it('falha de rede vira PixGatewayError', async () => {
		const { fetchFn } = fakeFetch([new Error('ECONNRESET')]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://x' },
			fetchFn
		);

		await expect(gateway.getQrCode('pay_1')).rejects.toBeInstanceOf(
			PixGatewayError
		);
	});

	it('QR sem payload é erro, não QR vazio na tela', async () => {
		const { fetchFn } = fakeFetch([{ status: 200, body: { success: false } }]);
		const gateway = new AsaasPixGateway(
			{ apiKey: KEY, baseUrl: 'https://x' },
			fetchFn
		);

		await expect(gateway.getQrCode('pay_1')).rejects.toBeInstanceOf(
			PixGatewayError
		);
	});
});
