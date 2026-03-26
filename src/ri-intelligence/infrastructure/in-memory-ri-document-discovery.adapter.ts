import { Injectable } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import {
	RiDocumentRecord,
	RiDocumentSource,
	RiDocumentType,
} from 'src/ri-intelligence/domain/ri-document.types';

interface CatalogEntry {
	documentType: RiDocumentType;
	title: string;
	period: string | null;
	publishedAt: string;
	source: RiDocumentSource;
}

@Injectable()
export class InMemoryRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly catalog: Record<string, CatalogEntry[]> = {
		BBDC4: [
			{
				documentType: 'earnings_release',
				title: 'Release de Resultados 4T25',
				period: '4T25',
				publishedAt: '2026-02-06T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://api.mziq.com/mzfilemanager/v2/d/8f9f45c2-6f5f-4b95-8f2f-c75bb4f677f2/7ae9d4ef-a2fa-a3f4-81d7-17f3f94589ec?origin=1',
				},
			},
			{
				documentType: 'investor_presentation',
				title: 'Apresentação Institucional',
				period: '2026',
				publishedAt: '2026-01-20T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://banco.bradesco/assets/classic/pdf/ri-apresentacao-institucional.pdf',
				},
			},
		],
		ITUB4: [
			{
				documentType: 'earnings_release',
				title: 'Release de Resultados 4T25',
				period: '4T25',
				publishedAt: '2026-02-05T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://www.itau.com.br/media/dam/m/2f3e95f95f3b8eeb/original/Release-de-resultados-4T25.pdf',
				},
			},
			{
				documentType: 'material_fact',
				title: 'Fato Relevante - Atualização Estratégica',
				period: null,
				publishedAt: '2026-02-14T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://www.itau.com.br/media/dam/m/5f95a93d41990f4/original/fato-relevante-atualizacao-estrategica.pdf',
				},
			},
		],
		BBAS3: [
			{
				documentType: 'shareholder_notice',
				title: 'Aviso aos Acionistas - Dividendos',
				period: '2026',
				publishedAt: '2026-02-01T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://ri.bb.com.br/wp-content/uploads/2026/02/aviso-aos-acionistas-dividendos.pdf',
				},
			},
		],
		PETR4: [
			{
				documentType: 'earnings_release',
				title: 'Release de Resultados 4T25',
				period: '4T25',
				publishedAt: '2026-02-26T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://petrobras.com.br/documents/20121/0/release-resultados-4t25.pdf',
				},
			},
		],
		VALE3: [
			{
				documentType: 'investor_presentation',
				title: 'Investor Day Presentation',
				period: '2026',
				publishedAt: '2026-03-01T00:00:00.000Z',
				source: {
					type: 'url',
					value: 'https://vale.com/documents/20143/0/investor-day-presentation-2026.pdf',
				},
			},
		],
	};

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const ticker = String(input.ticker || '').trim().toUpperCase();
		const company = String(input.company || '').trim();
		if (!ticker || !company) return [];

		const entries = this.catalog[ticker] || [];
		return entries.map((entry, index) => this.toRecord(input, entry, index));
	}

	private toRecord(
		input: RiDocumentDiscoveryInput,
		entry: CatalogEntry,
		index: number
	): RiDocumentRecord {
		return {
			id: `${input.ticker}:${entry.documentType}:${entry.publishedAt}:${index}`,
			ticker: input.ticker,
			company: input.company,
			title: entry.title,
			documentType: entry.documentType,
			period: entry.period,
			publishedAt: entry.publishedAt,
			source: entry.source,
			classification: {
				method: 'deterministic_rules',
				confidence: 'high',
			},
			contentStatus: 'metadata_only',
		};
	}
}
