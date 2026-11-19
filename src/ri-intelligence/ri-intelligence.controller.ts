import {
	Body,
	BadRequestException,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
	Logger,
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
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';
import { InvestorProfileService } from 'src/intelligence/application/investor-profile/investor-profile.service';
import {
	normalizeRiSummaryLevel,
	RiSummaryLevel,
} from 'src/ri-intelligence/application/ri-summary.types';

import { NotUserScoped } from 'src/auth/decorators/ownership.decorator';
interface RiSummaryBody {
	document?: RiDocumentRecord;
	content?: string | null;
}

@Controller('ri-intelligence')
export class RiIntelligenceController {
	private readonly logger = new Logger(RiIntelligenceController.name);

	constructor(
		private readonly catalogService: RiDocumentCatalogService,
		private readonly summaryService: RiDocumentSummaryService,
		private readonly contentResolver: RiDocumentContentResolver,
		private readonly investorProfile: InvestorProfileService
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

	@NotUserScoped('catálogo público de documentos de RI')
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
	@RequiresCapability('ri.ai_summary')
	async summarize(@Body() body: RiSummaryBody, @Req() req?: any) {
		if (!body?.document) throw new BadRequestException('ri_document_required');

		// O web nao consegue buscar o PDF do site de RI (CORS externo), entao a
		// extracao acontece server-side (TRA-85), no mesmo resolver que o chat
		// usa (TRA-253). `content` enviado pelo cliente e ignorado desde
		// TRA-238: com o resumo por IA ligado, aceitar texto arbitrario
		// transformava a rota num resumidor de uso geral pago pelo projeto.
		const resolved = await this.contentResolver.resolve(body.document);

		return this.summaryService.summarize({
			document: resolved.document,
			content: resolved.content,
			contentUnavailableReason: resolved.reason,
			level: await this.readerLevel(req),
		});
	}

	/**
	 * Nível de quem lê, pelo perfil de investidor (TRA-256). Falha ou perfil
	 * ausente vira o intermediário, o resumo de antes: nunca quebra a rota.
	 */
	private async readerLevel(req: any): Promise<RiSummaryLevel> {
		const userId =
			req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id;
		if (!userId) return normalizeRiSummaryLevel(null);
		try {
			const profile = await this.investorProfile.getEffectiveProfile(
				String(userId)
			);
			return normalizeRiSummaryLevel(profile?.sophistication);
		} catch (error) {
			this.logger.warn(
				`Nível do leitor indisponível, resumo intermediário: ${(error as Error)?.message ?? error}`
			);
			return normalizeRiSummaryLevel(null);
		}
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
