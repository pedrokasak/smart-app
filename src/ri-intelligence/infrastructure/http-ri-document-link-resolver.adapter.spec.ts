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
		global.fetch = jest.fn().mockResolvedValue({
			ok: response.status >= 200 && response.status < 300,
			status: response.status,
			url: response.url || 'https://ri.example.com/doc.pdf',
			headers: {
				get: (name: string) => {
					const key = name.toLowerCase();
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
		});
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
		mockFetch({
			status: 200,
			url: 'https://cdn.ri.example.com/final/release.pdf',
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
		mockFetch({
			status: 200,
			url: 'https://api.mziq.com/mzfilemanager/error/404',
			contentType: 'text/html',
		});

		const output = await adapter.resolve({
			url: 'https://api.mziq.com/mzfilemanager/v2/d/x/y',
		});

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('known_error_route');
	});

	it('rejects invalid http status', async () => {
		mockFetch({
			status: 404,
			url: 'https://ri.example.com/404.html',
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
});
