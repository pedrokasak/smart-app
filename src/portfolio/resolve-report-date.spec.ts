import { resolveReportDate } from './portfolio.controller';

/**
 * O padrão original era `/(19|20)\\d{2}/`. Dentro de um literal de regex,
 * `\\d` casa uma barra invertida literal seguida da letra "d" — nunca um
 * dígito. Nenhum nome de relatório real casava, então toda importação caía
 * no `new Date()` e carimbava os proventos do ano inteiro com o dia do
 * upload.
 */
describe('resolveReportDate', () => {
	it('extrai o ano do nome do relatório anual da B3', () => {
		const date = resolveReportDate('relatorio-consolidado-anual-2025.xlsx');
		expect(date.toISOString().slice(0, 10)).toBe('2025-12-31');
	});

	it('extrai o ano mesmo com sufixo de download duplicado', () => {
		// Nome exato do arquivo que o usuário reportou.
		const date = resolveReportDate(
			'relatorio-consolidado-anual-2025 (1).xlsx'
		);
		expect(date.toISOString().slice(0, 10)).toBe('2025-12-31');
	});

	it('aceita anos dos anos 1900', () => {
		const date = resolveReportDate('extrato-1998.xlsx');
		expect(date.toISOString().slice(0, 10)).toBe('1998-12-31');
	});

	it('usa a data atual quando o nome não traz ano', () => {
		const before = Date.now();
		const date = resolveReportDate('relatorio-sem-ano.xlsx');
		const after = Date.now();

		expect(date.getTime()).toBeGreaterThanOrEqual(before);
		expect(date.getTime()).toBeLessThanOrEqual(after);
	});

	it('usa a data atual quando não há nome de arquivo', () => {
		const before = Date.now();
		const date = resolveReportDate(undefined);
		const after = Date.now();

		expect(date.getTime()).toBeGreaterThanOrEqual(before);
		expect(date.getTime()).toBeLessThanOrEqual(after);
	});

	it('não confunde um número de 4 dígitos que não é ano', () => {
		// "4571608" (número de conta) não deve virar ano: o padrão exige
		// prefixo 19 ou 20.
		const date = resolveReportDate('extrato-conta-4571608.xlsx');
		const now = new Date();
		expect(date.getFullYear()).toBe(now.getFullYear());
	});
});
