import { asaasApiKey, asaasApiUrl } from 'src/env';
import { pixDueDate } from 'src/payments/pix/domain/pix-billing';
import { AsaasPixGateway } from './asaas-pix.gateway';

/**
 * Teste CONTRA O SANDBOX REAL do Asaas (TRA-195). Opt-in:
 *
 *   ASAAS_SANDBOX_E2E=1 npx jest asaas-pix.sandbox
 *
 * com `ASAAS_API_KEY` (chave de sandbox) e `ASAAS_API_URL` apontando para
 * https://api-sandbox.asaas.com no `.env`. Sem isso o describe é pulado — a
 * suíte padrão nunca depende de rede nem de credencial.
 *
 * Recusa rodar contra qualquer URL que não seja o sandbox: um engano no
 * `.env` não pode criar cliente e cobrança na conta de produção.
 */
const enabled = process.env.ASAAS_SANDBOX_E2E === '1';
const describeSandbox = enabled ? describe : describe.skip;

/** CPF válido gerado para o teste (dígitos verificadores corretos). */
function generateCpf(): string {
	const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
	const digit = (digits: number[]) => {
		const sum = digits.reduce(
			(acc, value, index) => acc + value * (digits.length + 1 - index),
			0
		);
		const rest = (sum * 10) % 11;
		return rest === 10 ? 0 : rest;
	};
	const first = digit(base);
	const second = digit([...base, first]);
	return [...base, first, second].join('');
}

describeSandbox('Asaas sandbox — PIX de verdade (opt-in)', () => {
	let gateway: AsaasPixGateway;

	beforeAll(() => {
		const baseUrl = AsaasPixGateway.normalizeBaseUrl(asaasApiUrl);
		if (!/^https:\/\/api-sandbox\.asaas\.com\/v3$/.test(baseUrl)) {
			throw new Error(
				`Recusado: ${baseUrl} não é o sandbox do Asaas. Este teste cria dados.`
			);
		}
		if (!asaasApiKey || asaasApiKey === 'test-key') {
			throw new Error('ASAAS_API_KEY de sandbox ausente no .env.');
		}
		gateway = new AsaasPixGateway({ apiKey: asaasApiKey, baseUrl });
	});

	it('cria cliente, cobrança PIX e devolve QR válido', async () => {
		const stamp = Date.now();
		const customerId = await gateway.createCustomer({
			name: `Trackerr Teste ${stamp}`,
			email: `pix-sandbox-${stamp}@trackerr.test`,
			cpf: generateCpf(),
			externalReference: `sandbox-user-${stamp}`,
		});
		expect(customerId).toMatch(/^cus_/);

		const { paymentId } = await gateway.createCharge({
			customerId,
			value: 5,
			dueDate: pixDueDate(new Date()),
			description: 'Trackerr · teste de integração sandbox',
			externalReference: `sandbox-charge-${stamp}`,
		});
		expect(paymentId).toMatch(/^pay_/);

		const qr = await gateway.getQrCode(paymentId);
		// Payload EMV do PIX começa com o indicador de formato "000201".
		expect(qr.payload.startsWith('000201')).toBe(true);
		expect(qr.encodedImage.length).toBeGreaterThan(100);
		expect(qr.expiresAt.getTime()).toBeGreaterThan(Date.now());
	}, 60_000);
});
