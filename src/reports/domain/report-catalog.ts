/**
 * Relatórios da tela Relatórios (TRA-171), na ordem e com os formatos do
 * handoff (`reportTypes` em Trackerr App.dc.html).
 */
export const REPORT_KINDS = [
	'portfolio',
	'income',
	'fiscal',
	'risk',
	'operations',
	'accountant',
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_FORMATS = ['pdf', 'xlsx', 'csv', 'zip'] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_CATALOG: Record<
	ReportKind,
	{ title: string; formats: ReportFormat[]; filePrefix: string }
> = {
	portfolio: {
		title: 'Carteira consolidada',
		formats: ['pdf', 'xlsx'],
		filePrefix: 'carteira-consolidada',
	},
	income: {
		title: 'Informe de rendimentos',
		formats: ['pdf', 'csv'],
		filePrefix: 'informe-de-rendimentos',
	},
	fiscal: {
		title: 'Apuração fiscal anual',
		formats: ['pdf', 'xlsx'],
		filePrefix: 'apuracao-fiscal',
	},
	risk: {
		title: 'Relatório de risco',
		formats: ['pdf'],
		filePrefix: 'relatorio-de-risco',
	},
	operations: {
		title: 'Extrato de operações',
		formats: ['csv', 'xlsx'],
		filePrefix: 'extrato-de-operacoes',
	},
	accountant: {
		title: 'Pacote do contador',
		formats: ['zip'],
		filePrefix: 'pacote-do-contador',
	},
};

export const CONTENT_TYPES: Record<ReportFormat, string> = {
	pdf: 'application/pdf',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	csv: 'text/csv; charset=utf-8',
	zip: 'application/zip',
};

export function isFormatAllowed(
	kind: ReportKind,
	format: ReportFormat
): boolean {
	return REPORT_CATALOG[kind].formats.includes(format);
}
