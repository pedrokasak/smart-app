import {
	Body,
	BadRequestException,
	Controller,
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
import { RiDocumentRecord, RiDocumentType } from 'src/ri-intelligence/domain/ri-document.types';

interface RiSummaryBody {
	document?: RiDocumentRecord;
	content?: string | null;
}

@Controller('ri-intelligence')
export class RiIntelligenceController {
	constructor(
		private readonly catalogService: RiDocumentCatalogService,
		private readonly summaryService: RiDocumentSummaryService
	) {}

	@Get('autocomplete')
	async autocomplete(
		@Query('query') query = '',
		@Query('limit') limit = '8'
	) {
		return this.catalogService.autocomplete(query, parseInt(limit, 10));
	}

	@Get('documents')
	async getDocuments(
		@Query('query') query = '',
		@Query('documentType') documentType?: string,
		@Query('limit') limit = '50'
	) {
		const input: SearchRiDocumentsInput = {
			query,
			documentType: this.parseDocumentType(documentType),
			limit: parseInt(limit, 10),
		};
		return this.catalogService.search(input);
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
		return this.summaryService.summarize({
			document: body.document,
			content: body.content || null,
		});
	}

	private parseDocumentType(value?: string): RiDocumentType | undefined {
		const normalized = String(value || '').trim();
		if (!normalized) return undefined;
		const allowed: RiDocumentType[] = [
			'earnings_release',
			'investor_presentation',
			'material_fact',
			'reference_form',
			'shareholder_notice',
			'other',
		];
		return allowed.includes(normalized as RiDocumentType)
			? (normalized as RiDocumentType)
			: undefined;
	}
}
