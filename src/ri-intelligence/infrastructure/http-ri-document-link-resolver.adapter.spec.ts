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
	}) {
		global.fetch = jest.fn().mockResolvedValue({
			ok: response.status >= 200 && response.status < 300,
			status: response.status,
			url: response.url || 'https://ri.example.com/doc.pdf',
			headers: {
				get: (name: string) =>
					name.toLowerCase() === 'content-type'
						? response.contentType || 'application/pdf'
						: null,
			},
			body: { cancel: jest.fn().mockResolvedValue(undefined) },
		});
	}

	it('resolves relative links into absolute urls using origin', async () => {
		mockFetch({ status: 200, url: 'https://ri.bradesco.com.br/docs/release-4t25.pdf' });

		const output = await adapter.resolve({
			url: '/docs/release-4t25.pdf',
			origin: 'https://ri.bradesco.com.br',
		});

		expect(global.fetch).toHaveBeenCalledWith(
			'https://ri.bradesco.com.br/docs/release-4t25.pdf',
			expect.objectContaining({ method: 'HEAD' })
		);
		expect(output.isValid).toBe(true);
		expect(output.resolvedUrl).toBe('https://ri.bradesco.com.br/docs/release-4t25.pdf');
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
		expect(output.resolvedUrl).toBe('https://cdn.ri.example.com/final/release.pdf');
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
		mockFetch({ status: 404, url: 'https://ri.example.com/404.html', contentType: 'text/html' });

		const output = await adapter.resolve({ url: 'https://ri.example.com/missing.pdf' });

		expect(output.isValid).toBe(false);
		expect(output.rejectionReason).toBe('invalid_http_status');
	});
});
