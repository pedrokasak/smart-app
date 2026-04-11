import { HttpRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-discovery.adapter';

describe('HttpRiDocumentDiscoveryAdapter', () => {
	const adapter = new HttpRiDocumentDiscoveryAdapter();
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		jest.clearAllMocks();
	});

	it('extracts RI document links from html and classifies material fact', async () => {
		global.fetch = jest.fn().mockImplementation(async (url: string) => {
			if (
				url.includes('/relacoes-com-investidores') ||
				url.includes('/documentos')
			) {
				return {
					ok: true,
					headers: { get: () => 'text/html; charset=utf-8' },
					text: async () =>
						`<html><body>
							<a href="/documentos/fato-relevante-2026-02-14.pdf">Fato Relevante - Atualização</a>
						</body></html>`,
				};
			}

			return {
				ok: false,
				headers: { get: () => 'text/html' },
				text: async () => '',
			};
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

	it('keeps recent guidance links even when url has no pdf extension', async () => {
		global.fetch = jest.fn().mockImplementation(async (url: string) => {
			if (url.includes('/ri') || url === 'https://vale.com/' || url === 'https://vale.com') {
				return {
					ok: true,
					headers: { get: () => 'text/html; charset=utf-8' },
					text: async () =>
						`<html><body>
							<a href="/documents/d/guest/vale-guidance-2026">Guidance 2026 - March update</a>
						</body></html>`,
				};
			}

			return {
				ok: false,
				headers: { get: () => 'text/html' },
				text: async () => '',
			};
		});

		const output = await adapter.discover({
			ticker: 'VALE3',
			company: 'Vale S.A.',
			origin: 'https://vale.com/ri',
		});

		expect(output.length).toBeGreaterThan(0);
		expect(output[0].source.value).toBe(
			'https://vale.com/documents/d/guest/vale-guidance-2026'
		);
		expect(output[0].documentType).toBe('other_ri_document');
	});

	it('follows RI navigation pages in the same domain before extracting documents', async () => {
		global.fetch = jest.fn().mockImplementation(async (url: string) => {
			if (url.includes('/pt/comunicados-resultados-apresentacoes-e-relatorios')) {
				return {
					ok: true,
					headers: { get: () => 'text/html; charset=utf-8' },
					text: async () =>
						`<html><body>
							<a href="/documents/d/guest/vale-release-1t26.pdf">Release de Resultados 1T26</a>
						</body></html>`,
				};
			}

			if (url === 'https://vale.com/' || url === 'https://vale.com') {
				return {
					ok: true,
					headers: { get: () => 'text/html; charset=utf-8' },
					text: async () =>
						`<html><body>
							<a href="/pt/comunicados-resultados-apresentacoes-e-relatorios">Comunicados e Resultados</a>
						</body></html>`,
				};
			}

			return {
				ok: false,
				headers: { get: () => 'text/html' },
				text: async () => '',
			};
		});

		const output = await adapter.discover({
			ticker: 'VALE3',
			company: 'Vale S.A.',
			origin: 'https://vale.com/ri',
		});

		expect(output.some((doc) => doc.source.value.includes('vale-release-1t26.pdf'))).toBe(true);
		expect(output.some((doc) => doc.documentType === 'earnings_release')).toBe(true);
	});

	it('discovers document candidates from robots sitemap entries', async () => {
		global.fetch = jest.fn().mockImplementation(async (url: string) => {
			if (url === 'https://example-ri.com/robots.txt') {
				return {
					ok: true,
					headers: { get: () => 'text/plain; charset=utf-8' },
					text: async () =>
						`User-agent: *\nAllow: /\nSitemap: https://example-ri.com/sitemap.xml`,
				};
			}

			if (url === 'https://example-ri.com/sitemap.xml') {
				return {
					ok: true,
					headers: { get: () => 'application/xml; charset=utf-8' },
					text: async () =>
						`<?xml version="1.0" encoding="UTF-8"?>
						<urlset>
							<url><loc>https://example-ri.com/documents/release-de-resultados-1t26.pdf</loc></url>
						</urlset>`,
				};
			}

			return {
				ok: false,
				headers: { get: () => 'text/html' },
				text: async () => '',
			};
		});

		const output = await adapter.discover({
			ticker: 'ABCD3',
			company: 'Empresa ABC',
			origin: 'https://example-ri.com/ri',
		});

		expect(output.length).toBeGreaterThan(0);
		expect(output.some((doc) => doc.source.value.includes('/documents/release-de-resultados-1t26.pdf'))).toBe(true);
		expect(output.some((doc) => doc.documentType === 'earnings_release')).toBe(true);
	});
});
