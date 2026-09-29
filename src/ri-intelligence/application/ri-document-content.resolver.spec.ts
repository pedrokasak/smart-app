import { RiDocumentContentPort } from 'src/ri-intelligence/application/ri-document-content.port';
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import { RiDocumentTextCachePort } from 'src/ri-intelligence/application/ri-document-text-cache.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

const LINK =
	'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&CodigoInstituicao=1&numProtocolo=1571942&numSequencia=1096648&numVersao=1';

function record(over: Partial<RiDocumentRecord> = {}): RiDocumentRecord {
	return {
		id: 'BBDC4:earnings_release:2026-02-10:abc:cvm',
		ticker: 'BBDC4',
		company: 'Bradesco',
		title: 'Release 4T25',
		documentType: 'earnings_release',
		period: '4T25',
		publishedAt: '2026-02-10T00:00:00.000Z',
		source: { type: 'url', value: LINK },
		classification: { method: 'deterministic_rules', confidence: 'high' },
		contentStatus: 'metadata_only',
		...over,
	};
}

describe('RiDocumentContentResolver (TRA-253)', () => {
	let content: { fetchTextContent: jest.Mock };
	let cache: { get: jest.Mock; set: jest.Mock };
	let resolver: RiDocumentContentResolver;

	beforeEach(() => {
		content = {
			fetchTextContent: jest.fn().mockResolvedValue({ text: 'texto do pdf' }),
		};
		cache = {
			get: jest.fn().mockResolvedValue(null),
			set: jest.fn().mockResolvedValue(undefined),
		};
		resolver = new RiDocumentContentResolver(
			content as unknown as RiDocumentContentPort,
			cache as unknown as RiDocumentTextCachePort
		);
	});

	it('downloads, keeps the text and marks the document extracted', async () => {
		const result = await resolver.resolve(record());

		expect(content.fetchTextContent).toHaveBeenCalledWith(LINK);
		expect(result).toMatchObject({
			content: 'texto do pdf',
			reason: null,
			from: 'download',
			document: { contentStatus: 'extracted' },
		});
		expect(cache.set).toHaveBeenCalledWith(
			'cvm:1571942:1096648:1',
			'texto do pdf',
			60 * 60 * 24 * 30
		);
	});

	it('serves the cached text without downloading', async () => {
		cache.get.mockResolvedValue('texto guardado');

		const result = await resolver.resolve(record());

		expect(content.fetchTextContent).not.toHaveBeenCalled();
		expect(result).toMatchObject({ content: 'texto guardado', from: 'cache' });
	});

	// Plano sem IA: o resumo estruturado aproveita o texto se ja estiver
	// guardado, mas nunca paga o download.
	it('never downloads when told to use the cache only', async () => {
		const result = await resolver.resolve(record(), { download: false });

		expect(content.fetchTextContent).not.toHaveBeenCalled();
		expect(result).toMatchObject({ content: null, reason: 'not_cached' });
		expect(result.document.contentStatus).toBe('metadata_only');
	});

	it('returns the reason when the PDF cannot be read', async () => {
		content.fetchTextContent.mockResolvedValue({
			text: null,
			reason: 'not_pdf',
		});

		const result = await resolver.resolve(record());

		expect(result).toMatchObject({ content: null, reason: 'not_pdf' });
		expect(cache.set).not.toHaveBeenCalled();
	});

	it('has nothing to download for a document without a link', async () => {
		const result = await resolver.resolve(
			record({ source: { type: 'file', value: 'x.pdf' } })
		);

		expect(result.reason).toBe('unsupported_source');
		expect(content.fetchTextContent).not.toHaveBeenCalled();
	});

	// O cache e atalho: fora do ar, vira download, nunca erro para o chat.
	it('falls back to downloading when the cache is down', async () => {
		cache.get.mockRejectedValue(new Error('mongo fora'));
		cache.set.mockRejectedValue(new Error('mongo fora'));

		const result = await resolver.resolve(record());

		expect(result).toMatchObject({ content: 'texto do pdf', from: 'download' });
	});
});
