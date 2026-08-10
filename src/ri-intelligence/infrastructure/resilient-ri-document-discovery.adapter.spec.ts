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
		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('ITUB4')]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('ITUB4')]),
		};
		const empty: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};

		// (inMemoryAdapter, httpAdapter, cvmAdapter, fiiAdapter, fallbackAdapter) —
		// ITUB4 é ação, então o httpAdapter (primary) é usado como primário.
		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			empty,
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

		// merge de primary (1) + fallback (1, ticker diferente) = 2 documentos.
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
			empty,
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
			{ discover: jest.fn().mockResolvedValue([]) },
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
			{ discover: jest.fn().mockResolvedValue([]) },
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
		inMemoryDocs?: any[];
		httpDocs?: any[];
	}) {
		const inMemoryAdapter = {
			discover: jest.fn().mockResolvedValue(overrides.inMemoryDocs || []),
		};
		const httpAdapter = { discover: jest.fn().mockResolvedValue(overrides.httpDocs || []) };
		const cvmAdapter = { discover: jest.fn().mockResolvedValue([]) };
		const fiiAdapter = { discover: jest.fn().mockResolvedValue([]) };
		const fallbackAdapter = { discover: jest.fn().mockResolvedValue([]) };

		const { ResilientRiDocumentDiscoveryAdapter } = require('./resilient-ri-document-discovery.adapter');
		const adapter = new ResilientRiDocumentDiscoveryAdapter(
			inMemoryAdapter,
			httpAdapter,
			cvmAdapter,
			fiiAdapter,
			fallbackAdapter,
			1000
		);
		return { adapter, inMemoryAdapter, httpAdapter, cvmAdapter };
	}

	it('includes in-memory catalog documents alongside http/cvm results for a known ticker', async () => {
		const { adapter } = buildAdapter({
			inMemoryDocs: [{ ticker: 'PETR4', documentType: 'earnings_release', title: 'In-memory doc', source: { value: 'x' } }],
			httpDocs: [{ ticker: 'PETR4', documentType: 'material_fact', title: 'Http doc', source: { value: 'y' } }],
		});

		const result = await adapter.discover({ ticker: 'PETR4', company: 'Petrobras', origin: 'https://petrobras.com.br/ri' });

		expect(result.map((d: any) => d.title)).toEqual(
			expect.arrayContaining(['In-memory doc', 'Http doc'])
		);
	});

	it('still returns http/cvm documents for a ticker with no in-memory catalog entry', async () => {
		const { adapter, inMemoryAdapter, httpAdapter } = buildAdapter({
			inMemoryDocs: [],
			httpDocs: [{ ticker: 'ABCD3', documentType: 'material_fact', title: 'Http doc', source: { value: 'y' } }],
		});

		const result = await adapter.discover({ ticker: 'ABCD3', company: 'Empresa', origin: 'https://ri.empresa.com.br' });

		expect(inMemoryAdapter.discover).toHaveBeenCalled();
		expect(httpAdapter.discover).toHaveBeenCalled();
		expect(result.map((d: any) => d.title)).toEqual(['Http doc']);
	});
});
