import { loadB3InvestorConfig } from './b3-investor.config';

const REQUIRED = {
	B3_INVESTOR_CLIENT_ID: 'client-id',
	B3_INVESTOR_CLIENT_SECRET: 'client-secret',
	B3_INVESTOR_CERT_PATH: '/secrets/b3/acesso.cer',
	B3_INVESTOR_KEY_PATH: '/secrets/b3/acesso.key',
};

describe('loadB3InvestorConfig', () => {
	it('is disabled when no required variable is set', () => {
		expect(loadB3InvestorConfig({})).toEqual({ status: 'disabled' });
	});

	it('treats blank values as missing', () => {
		expect(
			loadB3InvestorConfig({
				B3_INVESTOR_CLIENT_ID: '  ',
				B3_INVESTOR_CERT_PATH: '',
			})
		).toEqual({ status: 'disabled' });
	});

	it('reports which variables are missing when only part is set', () => {
		expect(
			loadB3InvestorConfig({
				B3_INVESTOR_CLIENT_ID: 'id',
				B3_INVESTOR_CERT_PATH: '/a.cer',
			})
		).toEqual({
			status: 'incomplete',
			missing: ['B3_INVESTOR_CLIENT_SECRET', 'B3_INVESTOR_KEY_PATH'],
		});
	});

	it('defaults to the certification environment and its documented hosts', () => {
		const result = loadB3InvestorConfig(REQUIRED);
		expect(result.status).toBe('configured');
		if (result.status !== 'configured') return;
		expect(result.config).toMatchObject({
			environment: 'certification',
			baseUrl: 'https://apib3i-cert.b3.com.br:2443',
			scope: '0c991613-4c90-454d-8685-d466a47669cb/.default',
			clientId: 'client-id',
			keyPassphrase: undefined,
			timeoutMs: 20000,
		});
		expect(result.config.tokenUrl).toContain(
			'login.microsoftonline.com/4bee639f'
		);
	});

	it('only uses production when asked explicitly', () => {
		const result = loadB3InvestorConfig({
			...REQUIRED,
			B3_INVESTOR_ENV: 'Production',
		});
		if (result.status !== 'configured') throw new Error('expected configured');
		expect(result.config.environment).toBe('production');
		expect(result.config.baseUrl).toBe('https://investidor.b3.com.br:2443');
		expect(result.config.scope).toBe(
			'abae5dfa-65e6-47c1-82ec-a54a8a3213b9/.default'
		);
	});

	it('falls back to certification on an unknown environment value', () => {
		const result = loadB3InvestorConfig({
			...REQUIRED,
			B3_INVESTOR_ENV: 'prod',
		});
		if (result.status !== 'configured') throw new Error('expected configured');
		expect(result.config.environment).toBe('certification');
	});

	it('accepts overrides and strips the trailing slash of the base URL', () => {
		const result = loadB3InvestorConfig({
			...REQUIRED,
			B3_INVESTOR_BASE_URL: 'https://b3.local:2443//',
			B3_INVESTOR_TOKEN_URL: 'https://token.local/oauth',
			B3_INVESTOR_SCOPE: 'custom/.default',
			B3_INVESTOR_KEY_PASSPHRASE: 'senha',
			B3_INVESTOR_CA_PATH: '/secrets/b3/ca.pem',
			B3_INVESTOR_TIMEOUT_MS: '5000',
		});
		if (result.status !== 'configured') throw new Error('expected configured');
		expect(result.config).toMatchObject({
			baseUrl: 'https://b3.local:2443',
			tokenUrl: 'https://token.local/oauth',
			scope: 'custom/.default',
			keyPassphrase: 'senha',
			caPath: '/secrets/b3/ca.pem',
			timeoutMs: 5000,
		});
	});

	it('ignores an invalid timeout', () => {
		const result = loadB3InvestorConfig({
			...REQUIRED,
			B3_INVESTOR_TIMEOUT_MS: 'abc',
		});
		if (result.status !== 'configured') throw new Error('expected configured');
		expect(result.config.timeoutMs).toBe(20000);
	});
});
