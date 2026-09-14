import * as XLSX from 'xlsx';
import {
	ReportCell,
	ReportColumn,
	ReportDocument,
	ReportTable,
} from 'src/reports/domain/report-document';

/**
 * Célula que começa com = + - @ (ou tab/CR) vira fórmula no Excel/Sheets.
 * Tickers e nomes vêm de arquivo importado pelo usuário: sem o apóstrofo,
 * um "=HYPERLINK(...)" num nome de ativo seria executado ao abrir o CSV.
 */
export function neutralizeFormula(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const currency = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL',
});
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
const percent = new Intl.NumberFormat('pt-BR', {
	style: 'percent',
	maximumFractionDigits: 2,
});

export function formatCell(column: ReportColumn, value: ReportCell): string {
	if (value === null || value === undefined || value === '') return '—';
	if (typeof value === 'number') {
		if (column.format === 'currency') return currency.format(value);
		if (column.format === 'percent') return percent.format(value);
		return decimal.format(value);
	}
	return String(value);
}

/** Planilha com valores numéricos de verdade (somáveis), não texto formatado. */
function tableToSheet(table: ReportTable): XLSX.WorkSheet {
	const header = table.columns.map((column) => column.label);
	const body = table.rows.map((row) =>
		table.columns.map((column) => {
			const value = row[column.key];
			if (value === null || value === undefined) return '';
			return typeof value === 'number'
				? value
				: neutralizeFormula(String(value));
		})
	);
	return XLSX.utils.aoa_to_sheet([header, ...body]);
}

// Nome de aba no Excel: até 31 caracteres, sem : \ / ? * [ ].
const sheetName = (title: string) =>
	title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

export function renderXlsx(document: ReportDocument): Buffer {
	const workbook = XLSX.utils.book_new();
	for (const table of document.tables) {
		XLSX.utils.book_append_sheet(
			workbook,
			tableToSheet(table),
			sheetName(table.title)
		);
	}
	return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * CSV do primeiro quadro, separado por ";" e com BOM: é o que o Excel em
 * português abre sem embaralhar colunas e acentos.
 */
export function renderCsv(document: ReportDocument): Buffer {
	const [table] = document.tables;
	const csv = table
		? XLSX.utils.sheet_to_csv(tableToSheet(table), { FS: ';' })
		: '';
	return Buffer.from(String.fromCharCode(0xfeff) + csv, 'utf8');
}

export function renderZip(files: { name: string; content: Buffer }[]): Buffer {
	const archive = XLSX.CFB.utils.cfb_new();
	for (const file of files) {
		XLSX.CFB.utils.cfb_add(archive, file.name, file.content);
	}
	return Buffer.from(
		XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' }) as Uint8Array
	);
}

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

export function renderHtml(document: ReportDocument): string {
	const summary = document.summary
		.map(
			(item) =>
				`<div class="kpi"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`
		)
		.join('');

	const tables = document.tables
		.map((table) => {
			const head = table.columns
				.map(
					(column) =>
						`<th class="${column.format === 'text' || column.format === 'date' ? '' : 'num'}">${escapeHtml(column.label)}</th>`
				)
				.join('');
			const rows = table.rows.length
				? table.rows
						.map(
							(row) =>
								`<tr>${table.columns
									.map(
										(column) =>
											`<td class="${column.format === 'text' || column.format === 'date' ? '' : 'num'}">${escapeHtml(formatCell(column, row[column.key]))}</td>`
									)
									.join('')}</tr>`
						)
						.join('')
				: `<tr><td colspan="${table.columns.length}" class="empty">Sem dados no período.</td></tr>`;
			return `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
		})
		.join('');

	const notes = document.notes.length
		? `<ul class="notes">${document.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
		: '';

	return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #1b1b1d; font-size: 11px; }
  header { background: #1b1b1d; color: #f4f2ec; padding: 18px 20px; border-radius: 8px; }
  header .brand { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #98a0ab; }
  header h1 { margin: 6px 0 4px; font-size: 20px; }
  header .sub { color: #b9bec6; font-size: 11px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .kpi { border: 1px solid #dedad0; border-radius: 8px; padding: 8px 10px; min-width: 150px; }
  .kpi span { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #6b6b70; }
  .kpi strong { font-size: 13px; }
  section { margin-top: 14px; page-break-inside: auto; }
  h2 { font-size: 13px; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #6b6b70; background: #f1efe8; padding: 6px 8px; }
  td { padding: 6px 8px; border-top: 1px solid #ebe8df; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: #8a8a90; text-align: center; }
  tr { page-break-inside: avoid; }
  .notes { margin: 14px 0 0; padding-left: 16px; color: #6b6b70; font-size: 10px; }
</style>
</head>
<body>
  <header>
    <div class="brand">Trackerr</div>
    <h1>${escapeHtml(document.title)}</h1>
    <div class="sub">${escapeHtml(document.subtitle)}</div>
  </header>
  <div class="kpis">${summary}</div>
  ${tables}
  ${notes}
</body>
</html>`;
}
