import { createB3InvestorData } from './b3-investor-data.factory';
import { HttpB3InvestorDataAdapter } from './http-b3-investor-data.adapter';

describe('createB3InvestorData', () => {
	it('returns an adapter that fails with not_configured when disabled', async () => {
		const warn = jest.fn();
		const port = createB3InvestorData({ status: 'disabled' }, warn);

		await expect(port.healthcheck()).rejects.toMatchObject({
			kind: 'not_configured',
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it('warns about the missing variables when the config is incomplete', async () => {
		const warn = jest.fn();
		const port = createB3InvestorData(
			{ status: 'incomplete', missing: ['B3_INVESTOR_KEY_PATH'] },
			warn
		);

		await expect(port.listAuthorizedInvestors()).rejects.toMatchObject({
			kind: 'not_configured',
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('B3_INVESTOR_KEY_PATH')
		);
	});

	it('does not throw at boot when the certificate file cannot be read', async () => {
		const warn = jest.fn();
		const port = createB3InvestorData(
			{
				status: 'configured',
				config: {
					environment: 'certification',
					baseUrl: 'https://apib3i-cert.b3.com.br:2443',
					tokenUrl: 'https://login.example/token',
					scope: 'abc/.default',
					clientId: 'id',
					clientSecret: 'secret',
					certPath: '/does/not/exist.cer',
					keyPath: '/does/not/exist.key',
					timeoutMs: 1000,
				},
			},
			warn
		);

		expect(port).not.toBeInstanceOf(HttpB3InvestorDataAdapter);
		await expect(port.healthcheck()).rejects.toMatchObject({
			kind: 'not_configured',
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('Certificado da B3')
		);
	});
});
