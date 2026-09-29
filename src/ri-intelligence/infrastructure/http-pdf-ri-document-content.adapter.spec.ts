import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { HttpPdfRiDocumentContentAdapter } from 'src/ri-intelligence/infrastructure/http-pdf-ri-document-content.adapter';
import { RiDocumentLinkResolverPort } from 'src/ri-intelligence/application/ri-document-link-resolver.port';

// A checagem de rede interna tem teste próprio; aqui o host é público.
jest.mock('src/common/net/public-http-url', () => ({
	assertPublicHttpUrl: jest.fn(async (raw: string) => new URL(raw)),
}));

// PDFParse é mockado: o que testamos aqui é o fluxo do adapter (guardas,
// resolucao, tratamento de erro), nao a lib de parsing de PDF.
const mockGetText = jest.fn();
const mockDestroy = jest.fn();
jest.mock('pdf-parse', () => ({
	PDFParse: jest.fn().mockImplementation(() => ({
		getText: mockGetText,
		destroy: mockDestroy,
	})),
}));

/** Bytes que comecam como um PDF de verdade (o parser e mockado). */
function pdfBytes(): Uint8Array {
	return new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
}

describe('HttpPdfRiDocumentContentAdapter (TRA-85)', () => {
	let httpService: { get: jest.Mock };
	let linkResolver: { resolve: jest.Mock };
	let adapter: HttpPdfRiDocumentContentAdapter;

	const validLink = {
		isValid: true,
		resolvedUrl: 'https://ri.example.com/release.pdf',
		statusCode: 200,
		contentType: 'application/pdf',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		httpService = { get: jest.fn() };
		linkResolver = { resolve: jest.fn().mockResolvedValue(validLink) };
		adapter = new HttpPdfRiDocumentContentAdapter(
			httpService as unknown as HttpService,
			linkResolver as unknown as RiDocumentLinkResolverPort
		);
	});

	it('extracts real text from a reachable PDF', async () => {
		httpService.get.mockReturnValue(of({ data: pdfBytes().buffer }));
		mockGetText.mockResolvedValue({
			text: '  Release de resultados: receita +12%.  ',
		});

		const result = await adapter.fetchTextContent(
			'https://ri.example.com/release.pdf'
		);

		expect(result.text).toBe('Release de resultados: receita +12%.');
		expect(mockDestroy).toHaveBeenCalledTimes(1);
	});

	it('returns empty_url for a blank url without touching the network', async () => {
		const result = await adapter.fetchTextContent('   ');
		expect(result).toEqual({ text: null, reason: 'empty_url' });
		expect(linkResolver.resolve).not.toHaveBeenCalled();
	});

	it('rejects when the link resolver says the url is invalid', async () => {
		linkResolver.resolve.mockResolvedValue({
			isValid: false,
			resolvedUrl: null,
		});
		const result = await adapter.fetchTextContent('https://x/err');
		expect(result.reason).toBe('link_invalid');
		expect(httpService.get).not.toHaveBeenCalled();
	});

	// A CVM serve o PDF oficial com `Content-Type: text/html` e o nome real no
	// `Content-Disposition` (filename=....pdf). O resolvedor de link ja aceita
	// isso; rejeitar aqui pelo content-type descartava todo documento da CVM.
	it('accepts the CVM download served as text/html when the body is a PDF', async () => {
		linkResolver.resolve.mockResolvedValue({
			...validLink,
			resolvedUrl:
				'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=1',
			contentType: 'text/html',
		});
		httpService.get.mockReturnValue(of({ data: pdfBytes().buffer }));
		mockGetText.mockResolvedValue({ text: 'Fato Relevante: aquisição.' });

		const result = await adapter.fetchTextContent(
			'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=1'
		);

		expect(result.text).toBe('Fato Relevante: aquisição.');
	});

	// A garantia de "nao parsear pagina HTML de erro" passa a vir do conteudo,
	// que nao mente: PDF comeca com `%PDF-`.
	it('rejects an HTML page served in place of the PDF, by its bytes', async () => {
		httpService.get.mockReturnValue(
			of({
				data: new TextEncoder().encode('<html><body>Erro</body></html>').buffer,
			})
		);

		const result = await adapter.fetchTextContent('https://x/notpdf');

		expect(result.reason).toBe('not_pdf');
		const { PDFParse } = jest.requireMock('pdf-parse');
		expect(PDFParse).not.toHaveBeenCalled();
	});

	it('maps an axios maxContentLength error to too_large', async () => {
		httpService.get.mockReturnValue(
			throwError(() => new Error('maxContentLength size of 26214400 exceeded'))
		);
		const result = await adapter.fetchTextContent('https://x/huge.pdf');
		expect(result.reason).toBe('too_large');
	});

	it('maps a generic network failure to fetch_failed', async () => {
		httpService.get.mockReturnValue(throwError(() => new Error('ETIMEDOUT')));
		const result = await adapter.fetchTextContent('https://x/slow.pdf');
		expect(result.reason).toBe('fetch_failed');
	});

	it('flags a scanned pdf with no text layer as empty_after_extract, not a false success', async () => {
		httpService.get.mockReturnValue(of({ data: pdfBytes().buffer }));
		mockGetText.mockResolvedValue({ text: '   ' });

		const result = await adapter.fetchTextContent('https://x/scan.pdf');

		expect(result.text).toBeNull();
		expect(result.reason).toBe('empty_after_extract');
	});

	it('maps a parser exception to extract_failed and still destroys nothing it did not create', async () => {
		httpService.get.mockReturnValue(of({ data: pdfBytes().buffer }));
		mockGetText.mockRejectedValue(new Error('corrupt pdf'));

		const result = await adapter.fetchTextContent('https://x/corrupt.pdf');

		expect(result.reason).toBe('extract_failed');
	});
});
