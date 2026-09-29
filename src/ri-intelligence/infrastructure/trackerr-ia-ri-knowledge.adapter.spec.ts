import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { TrackerrIaRiKnowledgeAdapter } from 'src/ri-intelligence/infrastructure/trackerr-ia-ri-knowledge.adapter';

const DOCUMENT = {
	key: 'a1b2c3',
	issuer: 'PETR',
	ticker: 'PETR4',
	company: 'Petrobras',
	title: 'Fato Relevante - Aquisição',
	category: 'Fato Relevante',
	documentType: 'material_fact',
	period: null,
	publishedAt: '2026-09-28',
	sourceUrl:
		'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=1571942',
};

const CITATION = {
	document_key: 'a1b2c3',
	title: 'ITR 2T26',
	category: 'Dados Econômico-Financeiros',
	period: '2T26',
	published_at: '2026-08-07',
	source_url: 'https://www.rad.cvm.gov.br/ENET/x',
	page: 3,
	excerpt: 'aprovou dividendos de R$ 0,45 por ação',
};

describe('TrackerrIaRiKnowledgeAdapter (TRA-264)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaRiKnowledgeAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaRiKnowledgeAdapter(
			httpService as unknown as HttpService
		);
	});

	it('sends the document in the trackerr-ia schema and reads the status', async () => {
		httpService.post.mockReturnValue(
			of({ data: { status: 'indexed', chunks: 3 } })
		);

		await expect(adapter.index(DOCUMENT, 'texto -- 1 of 1 --')).resolves.toBe(
			'indexed'
		);

		const [url, body, config] = httpService.post.mock.calls[0];
		expect(url).toMatch(/\/api\/ri\/index$/);
		expect(body).toEqual({
			document: {
				key: 'a1b2c3',
				issuer: 'PETR',
				ticker: 'PETR4',
				company: 'Petrobras',
				title: 'Fato Relevante - Aquisição',
				category: 'Fato Relevante',
				document_type: 'material_fact',
				period: null,
				published_at: '2026-09-28',
				source_url: DOCUMENT.sourceUrl,
			},
			content: 'texto -- 1 of 1 --',
		});
		expect(config.timeout).toBeGreaterThan(0);
	});

	it('fails on a status it does not know', async () => {
		httpService.post.mockReturnValue(of({ data: { status: 'ok' } }));

		await expect(adapter.index(DOCUMENT, 'texto')).rejects.toThrow(
			'ri_index_unexpected_response'
		);
	});

	it('reads the answer with its citations', async () => {
		httpService.post.mockReturnValue(
			of({
				data: {
					answer: [
						{ text: 'Dividendos de R$ 0,45 por ação.', citation: CITATION },
					],
					not_found: false,
				},
			})
		);

		const answer = await adapter.ask({
			issuer: 'PETR',
			question: 'dividendos?',
			publishedAfter: '2025-09-29',
		});

		expect(httpService.post.mock.calls[0][1]).toEqual({
			issuer: 'PETR',
			question: 'dividendos?',
			published_after: '2025-09-29',
		});
		expect(answer).toEqual({
			notFound: false,
			items: [
				{
					text: 'Dividendos de R$ 0,45 por ação.',
					citation: {
						documentKey: 'a1b2c3',
						title: 'ITR 2T26',
						category: 'Dados Econômico-Financeiros',
						period: '2T26',
						publishedAt: '2026-08-07',
						sourceUrl: 'https://www.rad.cvm.gov.br/ENET/x',
						page: 3,
						excerpt: 'aprovou dividendos de R$ 0,45 por ação',
					},
				},
			],
		});
	});

	// O chat nunca mostra afirmacao sem citacao.
	it('drops items without an excerpt or a document', async () => {
		httpService.post.mockReturnValue(
			of({
				data: {
					answer: [
						{ text: 'Sem trecho.', citation: { ...CITATION, excerpt: '' } },
						{ text: 'Sem documento.', citation: null },
						{ text: '   ', citation: CITATION },
					],
				},
			})
		);

		const answer = await adapter.ask({ issuer: 'PETR', question: 'x?' });

		expect(answer).toEqual({ items: [], notFound: true });
	});
});
