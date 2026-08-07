import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import {
	RiIssuerCatalogPort,
	RiIssuerRef,
} from 'src/ri-intelligence/application/ri-issuer-catalog.port';

// Schema IPE real (delimitador `;`):
// CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download
const IPE_HEADER =
	'CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download';

function ipeRow(overrides: Partial<Record<string, string>> = {}): string {
	const base: Record<string, string> = {
		CNPJ_Companhia: '33.000.167/0001-01',
		Nome_Companhia: 'Petróleo Brasileiro S.A. - Petrobras',
		Codigo_CVM: '9512',
		Data_Referencia: '2025-03-31',
		Categoria: 'Comunicado ao Mercado',
		Tipo: 'Resultados',
		Especie: 'Release',
		Assunto: 'Resultados do 1T25',
		Data_Entrega: '2025-05-07',
		Tipo_Apresentacao: '',
		Protocolo_Entrega: '12345',
		Versao: '1',
		Link_Download: 'https://www.rad.cvm.gov.br/enet/retorno-1t25.pdf',
	};
	return Object.keys(base)
		.map((key) => overrides[key] ?? base[key])
		.join(';');
}

/**
 * Subclasse de teste que substitui o seam de unzip por um dicionário de
 * CSVs sintetizados por ano — evita ter que gerar um zip real (yazl/jszip
 * não estão disponíveis e não queremos tocar o lockfile). A path de produção
 * com yauzl fica coberta por type-check e smoke online.
 */
class TestableCvmAdapter extends CvmRiDocumentDiscoveryAdapter {
	constructor(
		httpService: HttpService,
		issuerCatalog: RiIssuerCatalogPort,
		private readonly csvByYear: Record<number, string>
	) {
		super(httpService, issuerCatalog);
	}
	protected async extractCsvFromZip(
		_buffer: Buffer,
		year: number
	): Promise<string> {
		return this.csvByYear[year] ?? '';
	}
}

describe('CvmRiDocumentDiscoveryAdapter', () => {
	const issuer: RiIssuerRef = {
		ticker: 'PETR4',
		company: 'Petróleo Brasileiro S.A. - Petrobras',
		cnpj: '33.000.167/0001-01',
	};

	function makeHttpService(): HttpService {
		// O HttpService real é mocked porque o unzip seam já é substituído;
		// retornamos um ArrayBuffer qualquer.
		return {
			get: jest.fn().mockReturnValue(of({ data: new ArrayBuffer(0) } as any)),
		} as unknown as HttpService;
	}

	function makeCatalog(ref: RiIssuerRef | null): RiIssuerCatalogPort {
		return {
			resolveByTicker: jest.fn(async () => ref),
		};
	}

	/** Replica o CSV em todos os anos candidatos quando não há janela explícita
	 * (resolveCandidateYears pede últimos 3 anos sem dates). */
	function fillCandidateYears(csv: string): Record<number, string> {
		const base = new Date().getFullYear();
		return {
			[base]: csv,
			[base - 1]: csv,
			[base - 2]: csv,
		};
	}

	it('returns documents matching the issuer CNPJ and maps to RiDocumentRecord', async () => {
		const csv = [
			IPE_HEADER,
			ipeRow(), // matching
			ipeRow({
				CNPJ_Companhia: '60.872.504/0001-23',
				Link_Download: 'https://other/itub4.pdf',
			}), // non-matching CNPJ
		].join('\n');
		const httpService = makeHttpService();
		const adapter = new TestableCvmAdapter(
			httpService,
			makeCatalog(issuer),
			fillCandidateYears(csv)
		);

		const docs = await adapter.discover({
			ticker: 'PETR4',
			company: issuer.company,
			origin: 'https://petrobras.com.br/ri',
		});

		expect(docs).toHaveLength(1);
		const doc = docs[0];
		expect(doc.ticker).toBe('PETR4');
		expect(doc.source.value).toBe(
			'https://www.rad.cvm.gov.br/enet/retorno-1t25.pdf'
		);
		// Data_Entrega ISO `2025-05-07` → 2025-05-07T00:00:00.000Z.
		expect(doc.publishedAt).toBe('2025-05-07T00:00:00.000Z');
		// O classifier direciona `comunicado ao mercado` (alias de
		// material_fact, prioridade 100) → material_fact. A rotação exata é
		// coberta no spec do classifier; aqui validamos o glue de mapping
		// (link/data/ticker/title/contentStatus), não a heurística de tipo.
		expect(doc.documentType).toBe('material_fact');
		expect(doc.title).toContain('Comunicado ao Mercado');
		expect(doc.title).toContain('Resultados do 1T25');
		expect(doc.contentStatus).toBe('metadata_only');
	});

	it('returns [] when the issuer catalog has no CNPJ for the ticker', async () => {
		const httpService = makeHttpService();
		const adapter = new TestableCvmAdapter(httpService, makeCatalog(null), {});

		const docs = await adapter.discover({
			ticker: 'NOPE4',
			company: 'Sem CNPJ',
			origin: '',
		});

		expect(docs).toEqual([]);
	});

	it('filters by Data_Entrega inside the explicit date window', async () => {
		const csv = [
			IPE_HEADER,
			ipeRow({
				Data_Referencia: '2023-03-31',
				Assunto: 'Resultados do 1T23',
				Data_Entrega: '2023-05-08',
				Link_Download: 'https://rad/1t23.pdf',
			}),
			ipeRow({
				Data_Referencia: '2025-03-31',
				Assunto: 'Resultados do 1T25',
				Data_Entrega: '2025-05-07',
				Link_Download: 'https://rad/1t25.pdf',
			}),
		].join('\n');
		// janela explícita [2025-01-01, 2025-12-31] → resolveCandidateYears pede só 2025
		const httpService = makeHttpService();
		const adapter = new TestableCvmAdapter(httpService, makeCatalog(issuer), {
			2025: csv,
		});

		const docs = await adapter.discover({
			ticker: 'PETR4',
			company: issuer.company,
			origin: '',
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
		});

		expect(docs).toHaveLength(1);
		expect(docs[0].publishedAt).toBe('2025-05-07T00:00:00.000Z');
	});

	it('sorts documents by publishedAt descending and caps at maxDocuments', async () => {
		const rows = [IPE_HEADER];
		for (let i = 0; i < 45; i++) {
			const day = String(8 + (i % 20)).padStart(2, '0');
			// alternar entre 2023 e 2025 mantém datas variáveis e distintas
			const year = i % 2 === 0 ? '2023' : '2025';
			rows.push(
				ipeRow({
					Data_Referencia: `${year}-03-31`,
					Assunto: `Resultado ${i}`,
					Data_Entrega: `${year}-05-${day}`,
					Link_Download: `https://rad/doc-${i}.pdf`,
				})
			);
		}
		const csv = rows.join('\n');
		const httpService = makeHttpService();
		const adapter = new TestableCvmAdapter(
			httpService,
			makeCatalog(issuer),
			fillCandidateYears(csv)
		);

		const docs = await adapter.discover({
			ticker: 'PETR4',
			company: issuer.company,
			origin: '',
		});

		expect(docs.length).toBeLessThanOrEqual(40);
		// Descendente por publishedAt.
		for (let i = 1; i < docs.length; i++) {
			expect(
				new Date(docs[i - 1].publishedAt).getTime()
			).toBeGreaterThanOrEqual(new Date(docs[i].publishedAt).getTime());
		}
	});

	it('skips rows missing a download link or deliverable date', async () => {
		const csv = [
			IPE_HEADER,
			ipeRow({ Link_Download: '' }), // sem link → descartado
			ipeRow({ Data_Entrega: '' }), // sem data → descartado
			ipeRow({ Assunto: 'Válido', Data_Entrega: '2025-05-07' }), // válido
		].join('\n');
		const httpService = makeHttpService();
		const adapter = new TestableCvmAdapter(
			httpService,
			makeCatalog(issuer),
			fillCandidateYears(csv)
		);

		const docs = await adapter.discover({
			ticker: 'PETR4',
			company: issuer.company,
			origin: '',
		});

		expect(docs).toHaveLength(1);
	});
});
