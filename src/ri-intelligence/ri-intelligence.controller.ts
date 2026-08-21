import {
	Body,
	BadRequestException,
	Controller,
	Inject,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
} from '@nestjs/common';
import {
	RiDocumentCatalogService,
	SearchRiDocumentsInput,
} from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import {
	RiDocumentRecord,
	RiDocumentType,
} from 'src/ri-intelligence/domain/ri-document.types';
import { CANONICAL_RI_DOCUMENT_TYPES } from 'src/ri-intelligence/domain/ri-document-classifier';
import {
	RI_DOCUMENT_CONTENT,
	RiDocumentContentPort,
} from 'src/ri-intelligence/application/ri-document-content.port';

interface RiSummaryBody {
	document?: RiDocumentRecord;
	content?: string | null;
}

@Controller('ri-intelligence')
export class RiIntelligenceController {
	constructor(
		private readonly catalogService: RiDocumentCatalogService,
		private readonly summaryService: RiDocumentSummaryService,
		@Inject(RI_DOCUMENT_CONTENT)
		private readonly documentContent: RiDocumentContentPort
	) {}

	@Get('autocomplete')
	async autocomplete(@Query('query') query = '', @Query('limit') limit = '8') {
		return this.catalogService.autocomplete(query, parseInt(limit, 10));
	}

	@Get('documents')
	async getDocuments(
		@Query('query') query = '',
		@Query('documentType') documentType?: string,
		@Query('limit') limit = '50',
		@Query('dateFrom') dateFrom?: string,
		@Query('dateTo') dateTo?: string
	) {
		const input: SearchRiDocumentsInput = {
			query,
			documentType: this.parseDocumentType(documentType),
			limit: parseInt(limit, 10),
			dateFrom: this.parseIsoDate(dateFrom),
			dateTo: this.parseIsoDate(dateTo),
		};
		return this.catalogService.search(input);
	}

	@Get('documents/relevant')
	async getMostRelevantDocument(
		@Query('ticker') ticker = '',
		@Query('documentType') documentType?: string,
		@Query('dateFrom') dateFrom?: string,
		@Query('dateTo') dateTo?: string
	) {
		return this.catalogService.retrieveMostRelevantDocument({
			ticker,
			documentType: this.parseDocumentType(documentType),
			dateFrom: this.parseIsoDate(dateFrom),
			dateTo: this.parseIsoDate(dateTo),
		});
	}

	@Get('documents/:documentId/pdf')
	async getDocumentPdf(
		@Param('documentId') documentId: string,
		@Query('query') query = ''
	) {
		const result = await this.catalogService.getDocumentPdf(documentId, query);
		if (!result) throw new NotFoundException('ri_document_pdf_not_found');
		return result;
	}

	@Post('summary')
	async summarize(@Body() body: RiSummaryBody) {
		if (!body?.document) throw new BadRequestException('ri_document_required');

		// Conteudo pode vir do cliente, mas na pratica o web nao consegue
		// buscar o PDF do site de RI (CORS externo), entao a extracao acontece
		// aqui, server-side (TRA-85). Se o cliente ja mandou content, respeita.
		let content = body.content || null;
		if (!content && body.document.source?.type === 'url') {
			const fetched = await this.documentContent.fetchTextContent(
				body.document.source.value
			);
			content = fetched.text;
			if (content) {
				body.document = { ...body.document, contentStatus: 'extracted' };
			}
		}

		return this.summaryService.summarize({
			document: body.document,
			content,
		});
	}

	private parseDocumentType(value?: string): RiDocumentType | undefined {
		const normalized = String(value || '').trim();
		if (!normalized) return undefined;
		return CANONICAL_RI_DOCUMENT_TYPES.includes(normalized as RiDocumentType)
			? (normalized as RiDocumentType)
			: undefined;
	}

	/**
	 * Aceita ISO date (ex.: `2025-01-01` ou `2025-01-01T00:00:00.000Z`).
	 * Retorna `undefined` quando omitido (aditivo) e rejeita datas inválidas
	 * com 400, evitando propagar lixo para os adapters.
	 */
	private parseIsoDate(value?: string): string | undefined {
		const normalized = String(value || '').trim();
		if (!normalized) return undefined;
		const parsed = new Date(normalized);
		if (!Number.isFinite(parsed.getTime())) {
			throw new BadRequestException('ri_invalid_date_range');
		}
		return parsed.toISOString();
	}
}
