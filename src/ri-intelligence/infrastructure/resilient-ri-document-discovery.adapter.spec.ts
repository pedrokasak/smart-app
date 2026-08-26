import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { ResilientRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/resilient-ri-document-discovery.adapter';

describe('ResilientRiDocumentDiscoveryAdapter', () => {
	const baseDocument = (ticker: string): RiDocumentRecord => ({
		id: `${ticker}:earnings_release:2026-02-06T00:00:00.000Z:0`,
		ticker,
		company: 'Company',
		title: 'Release de Resultados 4T25',
		documentType: 'earnings_release',
		period: '4T25',
		publishedAt: '2026-02-06T00:00:00.000Z',
		source: {
			type: 'url',
			value: 'https://ri.example.com/doc.pdf',
		},
		classification: {
			method: 'deterministic_rules',
			confidence: 'high',
		},
		contentStatus: 'metadata_only',
	});

	it('returns deduplicated primary documents when primary succeeds', async () => {
		const primaryDocument = baseDocument('ITUB4');
		const fallbackDocument = baseDocument('ITUB4');
		fallbackDocument.id = 'ITUB4:material_fact:2026-02-10T00:00:00.000Z:0';
		fallbackDocument.documentType = 'material_fact';
		fallbackDocument.title = 'Fato Relevante';
		fallbackDocument.source.value = 'https://ri.example.com/fallback-doc.pdf';

		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([primaryDocument]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([fallbackDocument]),
		};
		const empty: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};

		// (inMemoryAdapter, httpAdapter, cvmAdapter, fiiAdapter, fallbackAdapter) —
		// ITUB4 é ação, então o httpAdapter (primary) é usado como primário.
		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			primary,
			empty,
			empty,
			fallback
		);
		const output = await adapter.discover({
			ticker: 'ITUB4',
			company: 'Itaú',
			origin: 'https://ri.example.com',
		});

		// primary e fallback trazem documentos genuinamente distintos (tipos e
		// fontes diferentes) — não devem ser colapsados pelo dedup, então o merge
		// resulta em 2 documentos.
		expect(output).toHaveLength(2);
		expect(output.some((doc) => doc.ticker === 'ITUB4')).toBe(true);
		expect(fallback.discover).toHaveBeenCalledTimes(1);
	});

	it('falls back to in-memory provider when primary fails or is empty', async () => {
		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};
		const cvm: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('PETR4')]),
		};
		const empty: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};

		// http (primary) vazio → cvm vazio → nenhum primário; fallback (puppeteer) retorn.
		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			primary,
			cvm,
			empty,
			fallback
		);
		const output = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://ri.example.com',
		});

		expect(output).toHaveLength(1);
		expect(output[0].ticker).toBe('PETR4');
		expect(fallback.discover).toHaveBeenCalledTimes(1);
	});

	it('returns fallback quickly when primary is slow', async () => {
		const primary: RiDocumentDiscoveryPort = {
			discover: jest
				.fn()
				.mockImplementation(
					() =>
						new Promise<RiDocumentRecord[]>((resolve) =>
							setTimeout(() => resolve([baseDocument('ITUB4')]), 200)
						)
				),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('PETR4')]),
		};

		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			primary,
			{ discover: jest.fn().mockResolvedValue([]) },
			{ discover: jest.fn().mockResolvedValue([]) },
			fallback,
			20
		);
		const output = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://ri.example.com',
		});

		// primary timeoutou → retorna [] no race; fallback entrega PETR4.
		expect(output).toHaveLength(1);
		expect(output[0].ticker).toBe('PETR4');
	});

	it('merges primary and fallback documents without duplicates', async () => {
		const shared = baseDocument('BBAS3');
		const primaryOnly = baseDocument('BBAS3');
		primaryOnly.id = 'BBAS3:material_fact:2026-02-14T00:00:00.000Z:0';
		primaryOnly.documentType = 'material_fact';
		primaryOnly.title = 'Fato Relevante';
		primaryOnly.source.value =
			'https://ri.example.com/primary-material-fact.pdf';

		const fallbackOnly = baseDocument('BBAS3');
		fallbackOnly.id = 'BBAS3:shareholder_notice:2026-02-01T00:00:00.000Z:0';
		fallbackOnly.documentType = 'shareholder_notice';
		fallbackOnly.title = 'Aviso aos Acionistas';
		fallbackOnly.source.value = 'https://ri.example.com/fallback-avisos.pdf';

		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([shared, primaryOnly]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([shared, fallbackOnly]),
		};

		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			primary,
			{ discover: jest.fn().mockResolvedValue([]) },
			{ discover: jest.fn().mockResolvedValue([]) },
			fallback
		);
		const output = await adapter.discover({
			ticker: 'BBAS3',
			company: 'Banco do Brasil',
			origin: 'https://ri.bb.com.br',
		});

		expect(output).toHaveLength(3);
		expect(
			output.some((doc) => doc.source.value.includes('primary-material-fact'))
		).toBe(true);
		expect(
			output.some((doc) => doc.source.value.includes('fallback-avisos'))
		).toBe(true);
	});
});

describe('ResilientRiDocumentDiscoveryAdapter — in-memory catalog', () => {
	function buildAdapter(overrides: {
		httpDocs?: any[];
		cvmDocs?: any[];
		fallbackDocs?: any[];
	}) {
		const httpAdapter = {
			discover: jest.fn().mockResolvedValue(overrides.httpDocs || []),
		};
		const cvmAdapter = {
			discover: jest.fn().mockResolvedValue(overrides.cvmDocs || []),
		};
		const fiiAdapter = { discover: jest.fn().mockResolvedValue([]) };
		const fallbackAdapter = {
			discover: jest.fn().mockResolvedValue(overrides.fallbackDocs || []),
		};

		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			httpAdapter,
			cvmAdapter,
			fiiAdapter,
			fallbackAdapter,
			1000
		);
		return { adapter, httpAdapter, cvmAdapter, fallbackAdapter };
	}

	/**
	 * O catalogo em memoria saiu da cadeia: as URLs eram inventadas e as
	 * quatro respondiam 404. Pior, entravam primeiro na deduplicacao e
	 * podiam ofuscar um documento realmente descoberto.
	 */
	it('devolve os documentos descobertos de verdade', async () => {
		const { adapter, httpAdapter } = buildAdapter({
			httpDocs: [
				{
					ticker: 'PETR4',
					documentType: 'material_fact',
					title: 'Http doc',
					source: { value: 'y' },
				},
			],
		});

		const result = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://petrobras.com.br/ri',
		});

		expect(httpAdapter.discover).toHaveBeenCalled();
		expect(result.map((d: any) => d.title)).toEqual(['Http doc']);
	});

	/**
	 * BBAS3 em producao: o Puppeteer devolvia 20 links, todos paginas de
	 * evento em HTML que a validacao descarta depois. Como o adapter HTTP
	 * "encontrou algo", a CVM — unica fonte com o PDF de verdade — nunca era
	 * consultada, e o resultado final era zero.
	 */
	it('consulta a CVM mesmo quando o adapter HTTP ja encontrou links', async () => {
		const { adapter, httpAdapter, cvmAdapter } = buildAdapter({
			httpDocs: [
				{
					ticker: 'BBAS3',
					documentType: 'other_ri_document',
					title: 'Pagina de evento',
					source: { value: 'https://ri.bb.com.br/evento/x/' },
				},
			],
			cvmDocs: [
				{
					ticker: 'BBAS3',
					documentType: 'earnings_release',
					title: 'Release CVM',
					source: { value: 'https://www.rad.cvm.gov.br/ENET/doc.aspx?p=1' },
				},
			],
		});

		const result = await adapter.discover({
			ticker: 'BBAS3',
			company: 'Banco do Brasil',
			origin: 'https://ri.bb.com.br',
		});

		expect(httpAdapter.discover).toHaveBeenCalled();
		expect(cvmAdapter.discover).toHaveBeenCalled();
		expect(result.map((d: any) => d.title).sort()).toEqual([
			'Pagina de evento',
			'Release CVM',
		]);
	});

	it('devolve vazio quando nenhuma fonte real encontra documento', async () => {
		// Vazio e honesto. Antes, um ticker do catalogo recebia um link
		// fabricado que quebrava ao clicar.
		const { adapter } = buildAdapter({ httpDocs: [] });

		const result = await adapter.discover({
			ticker: 'BBAS3',
			company: 'Banco do Brasil',
			origin: 'https://ri.bb.com.br',
		});

		expect(result).toEqual([]);
	});
});
