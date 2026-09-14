/**
 * Formato neutro de um relatório: o builder monta os dados uma vez e cada
 * renderer (PDF, XLSX, CSV) só decide a apresentação.
 */
export type ReportCellFormat =
	| 'text'
	| 'currency'
	| 'number'
	| 'percent'
	| 'date';

export interface ReportColumn {
	key: string;
	label: string;
	format: ReportCellFormat;
}

export type ReportCell = string | number | null;

export interface ReportTable {
	title: string;
	columns: ReportColumn[];
	rows: Record<string, ReportCell>[];
}

export interface ReportDocument {
	title: string;
	subtitle: string;
	summary: { label: string; value: string }[];
	tables: ReportTable[];
	notes: string[];
}
