import { HttpRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-discovery.adapter';

describe('HttpRiDocumentDiscoveryAdapter', () => {
	const adapter = new HttpRiDocumentDiscoveryAdapter();
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		jest.clearAllMocks();
	});

	it('extracts RI document links from html and classifies material fact', async () => {
		global.fetch = jest
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				headers: { get: () => 'text/html; charset=utf-8' },
				text: async () =>
					`<html><body>
						<a href="/documentos/fato-relevante-2026-02-14.pdf">Fato Relevante - Atualização</a>
					</body></html>`,
			})
			.mockResolvedValue({
				ok: false,
				headers: { get: () => 'text/html' },
				text: async () => '',
			});

		const output = await adapter.discover({
			ticker: 'ITUB4',
			company: 'Itaú Unibanco Holding S.A.',
			origin: 'https://www.itau.com.br/relacoes-com-investidores',
		});

		expect(output.length).toBeGreaterThan(0);
		expect(output[0].source.value).toBe(
			'https://www.itau.com.br/documentos/fato-relevante-2026-02-14.pdf'
		);
		expect(output[0].documentType).toBe('material_fact');
		expect(output[0].ticker).toBe('ITUB4');
	});

	it('returns empty list when network is unavailable', async () => {
		global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

		const output = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://petrobras.com.br/ri',
		});

		expect(output).toEqual([]);
	});
});
