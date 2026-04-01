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

	it('returns primary documents when primary succeeds', async () => {
		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('ITUB4')]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('BBDC4')]),
		};

		const adapter = new ResilientRiDocumentDiscoveryAdapter(primary, fallback);
		const output = await adapter.discover({
			ticker: 'ITUB4',
			company: 'Itaú',
			origin: 'https://ri.example.com',
		});

		expect(output).toHaveLength(1);
		expect(output[0].ticker).toBe('ITUB4');
		expect(fallback.discover).not.toHaveBeenCalled();
	});

	it('falls back to in-memory provider when primary fails or is empty', async () => {
		const primary: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([]),
		};
		const fallback: RiDocumentDiscoveryPort = {
			discover: jest.fn().mockResolvedValue([baseDocument('PETR4')]),
		};

		const adapter = new ResilientRiDocumentDiscoveryAdapter(primary, fallback);
		const output = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://ri.example.com',
		});

		expect(output).toHaveLength(1);
		expect(output[0].ticker).toBe('PETR4');
		expect(fallback.discover).toHaveBeenCalledTimes(1);
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

		const adapter = new ResilientRiDocumentDiscoveryAdapter(primary, fallback);
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
