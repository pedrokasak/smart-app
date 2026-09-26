// DNS real fora dos testes: hostname é tratado como público; IP literal
// passa pela checagem de verdade (é o que os testes de SSRF exercitam).
jest.mock('src/common/net/public-http-url', () => {
	const actual = jest.requireActual('src/common/net/public-http-url');
	const { isIP } = jest.requireActual('node:net');
	return {
		...actual,
		assertPublicHttpUrl: jest.fn(async (raw: string) => {
			const url = new URL(raw);
			const host = url.hostname.replace(/^\[|\]$/g, '');
			const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
			return isIP(host) || !isHttp ? actual.assertPublicHttpUrl(raw) : url;
		}),
	};
});

import { HttpRiDocumentLinkResolverAdapter } from 'src/ri-intelligence/infrastructure/http-ri-document-link-resolver.adapter';

describe('HttpRiDocumentLinkResolverAdapter', () => {
	const adapter = new HttpRiDocumentLinkResolverAdapter();
	const originalFetch = global.fetch;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	function mockFetch(response: {
		status: number;
		url?: string;
		contentType?: string;
		contentDisposition?: string;
	}) {
		global.fetch = jest.fn().mockResolvedValue(fakeResponse(response));
	}

	function fakeResponse(response: {
		status: number;
		location?: string;
		contentType?: string;
		contentDisposition?: string;
	}) {
		return {
			ok: response.status >= 200 && response.status < 300,
			status: response.status,
			headers: {
				get: (name: string) => {
					const key = name.toLowerCase();
					if (key === 'location') return response.location ?? null;
					if (key === 'content-type') {
						return response.contentType || 'application/pdf';
					}
					if (key === 'content-disposition') {
						return response.contentDisposition ?? null;
					}
					return null;
				},
			},
			body: { cancel: jest.fn().mockResolvedValue(undefined) },
		};
	}

	/** Um 302 para `location`, depois `final` — redirect seguido à mão. */
	function mockRedirect(
		location: string,
		final: { status: number; contentType?: string }
	) {
		// Toda requisição à URL de origem redireciona (HEAD e o GET de retry).
		global.fetch = jest.fn(async (url: string) =>
			url === location
				? fakeResponse(final)
				: fakeResponse({ status: 302, location })
		) as any;
	}

	it('resolves relative links into absolute urls using origin', async () => {
		mockFetch({
			status: 200,
			url: 'https://ri.bradesco.com.br/docs/release-4t25.pdf',
		});

		const output = await adapter.resolve({
			url: '/docs/release-4t25.pdf',
			origin: 'https://ri.bradesco.com.br',
		});

		expect(global.fetch).toHaveBeenCalledWith(
			'https://ri.bradesco.com.br/docs/release-4t25.pdf',
			expect.objectContaining({ method: 'HEAD' })
		);
		expect(output.isValid).toBe(true);
		expect(output.resolvedUrl).toBe(
			'https://ri.bradesco.com.br/docs/release-4t25.pdf'
		);
	});

	it('keeps redirected final url when destination is valid', async () => {
		mockRedirect('https://cdn.ri.example.com/final/release.pdf', {
			status: 200,
			contentType: 'application/pdf',
		});

		const output = await adapter.resolve({
			url: 'https://ri.example.com/redirect?id=123',
		});

		expect(output.isValid).toBe(true);
		expect(output.resolvedUrl).toBe(
			'https://cdn.ri.example.com/final/release.pdf'
		);
	});

	it('rejects known mziq error routes even with 200 status', async () => {
		mockRedirect('https://api.mziq.com/mzfilemanager/error/404', {
			status: 200,
			contentType: 'text/html',
		});

		const output = await adapter.resolve({
			url: 'https://api.mziq.com/mzfilemanager/v2/d/x/y',
		});

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('known_error_route');
	});

	it('rejects invalid http status', async () => {
		mockRedirect('https://ri.example.com/404.html', {
			status: 404,
			contentType: 'text/html',
		});

		const output = await adapter.resolve({
			url: 'https://ri.example.com/missing.pdf',
		});

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('invalid_http_status');
	});

	// TRA-92: reproduzido em produção — a CVM (fonte oficial, a mais
	// confiável de todas) devolve Content-Type: text/html para um PDF de
	// verdade; quem diz a verdade é o Content-Disposition. Antes deste
	// teste, um documento oficial de verdade era descartado com o mesmo
	// motivo de uma página de erro.
	it('accepts a CVM ENET download despite its misleading text/html content-type', async () => {
		mockFetch({
			status: 200,
			url: 'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1560116',
			contentType: 'text/html',
			contentDisposition: 'attachment; filename=000906000101012.pdf',
		});

		const output = await adapter.resolve({
			url: 'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1560116',
		});

		expect(output.isValid).toBe(true);
		expect(output.resolvedUrl).toBe(
			'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1560116'
		);
	});

	it('accepts a quoted UTF-8 filename* disposition', async () => {
		mockFetch({
			status: 200,
			url: 'https://ri.example.com/download?id=1',
			contentType: 'text/html',
			contentDisposition: "attachment; filename*=UTF-8''Relat%C3%B3rio.pdf",
		});

		const output = await adapter.resolve({
			url: 'https://ri.example.com/download?id=1',
		});

		expect(output.isValid).toBe(true);
	});

	it('still rejects a genuine HTML page with no file disposition', async () => {
		mockFetch({
			status: 200,
			url: 'https://ri.bb.com.br/evento/apresentacao-1t26/',
			contentType: 'text/html',
		});

		const output = await adapter.resolve({
			url: 'https://ri.bb.com.br/evento/apresentacao-1t26/',
		});

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('invalid_content_type');
	});

	it('rejects text/html with a disposition filename that is not a supported extension', async () => {
		mockFetch({
			status: 200,
			url: 'https://ri.example.com/page',
			contentType: 'text/html',
			contentDisposition: 'inline; filename=page.html',
		});

		const output = await adapter.resolve({
			url: 'https://ri.example.com/page',
		});

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('invalid_content_type');
	});

	describe('SSRF (TRA-211)', () => {
		it.each([
			'http://127.0.0.1/doc.pdf',
			'http://169.254.169.254/latest/meta-data/',
			'http://10.0.0.5:8000/api/health',
			'http://[::1]/doc.pdf',
			'http://[::ffff:192.168.0.10]/doc.pdf',
			'file:///app/.env',
			'ftp://ri.example.com/doc.pdf',
		])('recusa %s sem fazer requisição', async (url) => {
			mockFetch({ status: 200 });

			const output = await adapter.resolve({ url });

			expect(output.isValid).toBe(false);
			expect(global.fetch).not.toHaveBeenCalled();
		});

		it('recusa redirect para a rede interna', async () => {
			mockRedirect('http://172.17.0.1:6379/', { status: 200 });

			const output = await adapter.resolve({
				url: 'https://ri.example.com/redirect',
			});

			expect(output.isValid).toBe(false);
			const requested = (global.fetch as jest.Mock).mock.calls.map((c) => c[0]);
			expect(requested).not.toContain('http://172.17.0.1:6379/');
		});

		it('para de seguir depois de 5 redirects', async () => {
			global.fetch = jest
				.fn()
				.mockResolvedValue(
					fakeResponse({ status: 302, location: 'https://ri.example.com/loop' })
				);

			const output = await adapter.resolve({
				url: 'https://ri.example.com/loop',
			});

			expect(output.isValid).toBe(false);
		});
	});
});
