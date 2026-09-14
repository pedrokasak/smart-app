import { BadRequestException, Injectable } from '@nestjs/common';
import { renderHtmlToPdf } from 'src/common/pdf/render-html-to-pdf';
import {
	CONTENT_TYPES,
	REPORT_CATALOG,
	ReportFormat,
	ReportKind,
	isFormatAllowed,
} from 'src/reports/domain/report-catalog';
import { ReportDocument } from 'src/reports/domain/report-document';
import {
	renderCsv,
	renderHtml,
	renderXlsx,
	renderZip,
} from 'src/reports/infrastructure/report-renderers';
import { ReportBuilderService } from './report-builder.service';

export interface GeneratedReport {
	filename: string;
	contentType: string;
	content: Buffer;
}

@Injectable()
export class ReportsService {
	constructor(private readonly builder: ReportBuilderService) {}

	async generate(
		userId: string,
		kind: ReportKind,
		format: ReportFormat,
		year: number
	): Promise<GeneratedReport> {
		if (!isFormatAllowed(kind, format)) {
			throw new BadRequestException(
				`${REPORT_CATALOG[kind].title} não está disponível em ${format.toUpperCase()}.`
			);
		}

		const content =
			kind === 'accountant'
				? await this.accountantPackage(userId, year)
				: await this.render(
						await this.builder.build(userId, kind, year),
						format
					);

		return {
			filename: `${REPORT_CATALOG[kind].filePrefix}-${year}.${format}`,
			contentType: CONTENT_TYPES[format],
			content,
		};
	}

	private render(
		document: ReportDocument,
		format: ReportFormat
	): Promise<Buffer> | Buffer {
		if (format === 'pdf') return renderHtmlToPdf(renderHtml(document));
		if (format === 'xlsx') return renderXlsx(document);
		return renderCsv(document);
	}

	/** O que um contador pede: fiscal em PDF e planilha, proventos e operações. */
	private async accountantPackage(
		userId: string,
		year: number
	): Promise<Buffer> {
		const [fiscal, income, operations] = await Promise.all([
			this.builder.build(userId, 'fiscal', year),
			this.builder.build(userId, 'income', year),
			this.builder.build(userId, 'operations', year),
		]);
		return renderZip([
			{
				name: `apuracao-fiscal-${year}.pdf`,
				content: await renderHtmlToPdf(renderHtml(fiscal)),
			},
			{ name: `apuracao-fiscal-${year}.xlsx`, content: renderXlsx(fiscal) },
			{
				name: `informe-de-rendimentos-${year}.csv`,
				content: renderCsv(income),
			},
			{
				name: `extrato-de-operacoes-${year}.csv`,
				content: renderCsv(operations),
			},
		]);
	}
}
