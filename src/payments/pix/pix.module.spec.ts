import { AsaasPixGateway } from './infrastructure/asaas-pix.gateway';
import { DisabledPixGateway } from './infrastructure/disabled-pix.gateway';
import { createPixGateway } from './pix.module';

/**
 * Quando o checkout PIX sobe ligado (TRA-195). Produção hoje tem uma chave de
 * SANDBOX do Asaas configurada: se a presença de chave bastasse, o deploy
 * exporia a clientes reais um QR que banco nenhum paga.
 */
describe('createPixGateway', () => {
	const real = {
		enabled: true,
		apiKey: '$aact_prod_chave',
		baseUrl: 'https://api.asaas.com/v3',
		nodeEnv: 'production',
	};

	it('liga com flag, chave real e URL de produção', () => {
		expect(createPixGateway(real)).toBeInstanceOf(AsaasPixGateway);
	});

	it('sem PIX_CHECKOUT_ENABLED=true fica desligado, mesmo com chave', () => {
		expect(createPixGateway({ ...real, enabled: false })).toBeInstanceOf(
			DisabledPixGateway
		);
	});

	it.each(['', 'test-key', '  test-key  ', undefined])(
		'chave placeholder %p fica desligado',
		(apiKey) => {
			expect(createPixGateway({ ...real, apiKey })).toBeInstanceOf(
				DisabledPixGateway
			);
		}
	);

	it('produção apontando para o sandbox fica desligado', () => {
		const gateway = createPixGateway({
			...real,
			baseUrl: 'https://api-sandbox.asaas.com/',
		});
		expect(gateway).toBeInstanceOf(DisabledPixGateway);
		expect(gateway.isEnabled()).toBe(false);
	});

	it('fora de produção o sandbox é permitido', () => {
		expect(
			createPixGateway({
				...real,
				nodeEnv: 'development',
				baseUrl: 'https://api-sandbox.asaas.com/',
			})
		).toBeInstanceOf(AsaasPixGateway);
	});
});
