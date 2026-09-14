import * as XLSX from 'xlsx';
import {
	neutralizeFormula,
	renderCsv,
	renderHtml,
	renderXlsx,
	renderZip,
} from './report-renderers';
import { ReportDocument } from 'src/reports/domain/report-document';

const document: ReportDocument = {
	title: 'Extrato de operações',
	subtitle: 'Ano-base 2026',
	summary: [{ label: 'Operações', value: '2' }],
	tables: [
		{
			title: 'Operações',
			columns: [
				{ key: 'symbol', label: 'Ativo', format: 'text' },
				{ key: 'total', label: 'Total', format: 'currency' },
			],
			rows: [
				{ symbol: 'PETR4', total: 1234.5 },
				{ symbol: '=HYPERLINK("http://x")', total: 10 },
			],
		},
	],
	notes: ['<script>alert(1)</script>'],
};

describe('report renderers', () => {
	it('neutralizes spreadsheet formulas coming from imported data', () => {
		expect(neutralizeFormula('=1+1')).toBe("'=1+1");
		expect(neutralizeFormula('-10')).toBe("'-10");
		expect(neutralizeFormula('PETR4')).toBe('PETR4');
	});

	it('writes a pt-BR friendly CSV with BOM and neutralized cells', () => {
		const csv = renderCsv(document).toString('utf8');

		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('Ativo;Total');
		expect(csv).toContain('PETR4;1234.5');
		expect(csv).toContain(`'=HYPERLINK`);
	});

	it('keeps numbers numeric in XLSX', () => {
		const workbook = XLSX.read(renderXlsx(document), { type: 'buffer' });
		const sheet = workbook.Sheets['Operações'];

		expect(sheet.B2.t).toBe('n');
		expect(sheet.B2.v).toBe(1234.5);
		expect(sheet.A3.v).toBe(`'=HYPERLINK("http://x")`);
	});

	it('zips files that can be read back', () => {
		const zip = renderZip([
			{ name: 'a.csv', content: Buffer.from('x;y') },
			{ name: 'b.pdf', content: Buffer.from('%PDF') },
		]);
		const archive = XLSX.CFB.read(zip, { type: 'buffer' });
		const names = archive.FileIndex.map((entry) => entry.name);

		expect(zip.subarray(0, 2).toString()).toBe('PK');
		expect(names).toEqual(expect.arrayContaining(['a.csv', 'b.pdf']));
	});

	it('escapes HTML in the PDF template', () => {
		const html = renderHtml(document);

		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('R$');
	});
});
