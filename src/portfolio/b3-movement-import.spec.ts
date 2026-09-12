import * as xlsx from 'xlsx';
import { parseB3Workbook } from './portfolio.controller';

/**
 * Extrato de movimentação da B3 — a única exportação com data de pagamento
 * por provento. Antes deste suporte, `detectSheetKind` não reconhecia a aba
 * ("Entrada/Saída | Data | Movimentação | Produto | ...") e o arquivo inteiro
 * era ignorado em silêncio.
 *
 * A planilha é montada aqui com as mesmas colunas e o mesmo formato de valor
 * (ponto decimal, data dd/mm/aaaa) de um extrato real.
 */
const buildMovementWorkbook = (rows: any[][]): xlsx.WorkBook => {
	const header = [
		'Entrada/Saída',
		'Data',
		'Movimentação',
		'Produto',
		'Instituição',
		'Quantidade',
		'Preço unitário',
		'Valor da Operação',
	];
	const sheet = xlsx.utils.aoa_to_sheet([header, ...rows]);
	const workbook = xlsx.utils.book_new();
	xlsx.utils.book_append_sheet(workbook, sheet, 'Movimentação');
	return workbook;
};

const REPORT_DATE = new Date(Date.UTC(2025, 11, 31));

describe('importação do extrato de movimentação', () => {
	it('lê proventos com a data real de cada pagamento', () => {
		const workbook = buildMovementWorkbook([
			[
				'Credito',
				'14/08/2026',
				'Rendimento',
				'HGLG11 - PÁTRIA LOG - FDO INV IMOB',
				'BANCO BTG PACTUAL S/A.',
				'6',
				'1.17',
				'7.02',
			],
			[
				'Credito',
				'20/08/2026',
				'Juros Sobre Capital Próprio',
				'PETR4 - PETROLEO BRASILEIRO S.A.',
				'BANCO BTG PACTUAL S/A.',
				'8',
				'0.35',
				'2.31',
			],
		]);

		const { dividendsBySymbol, hasDatedDividends } = parseB3Workbook(
			workbook,
			REPORT_DATE
		);

		expect(hasDatedDividends).toBe(true);

		const hglg = dividendsBySymbol.get('HGLG11');
		expect(hglg).toHaveLength(1);
		expect(hglg![0].totalValue).toBe(7.02);
		expect(hglg![0].paymentType).toBe('RENDIMENTO');
		expect(hglg![0].eventDate.toISOString().slice(0, 10)).toBe('2026-08-14');

		const petr = dividendsBySymbol.get('PETR4');
		expect(petr![0].paymentType).toBe('JCP');
		expect(petr![0].eventDate.toISOString().slice(0, 10)).toBe('2026-08-20');
	});

	it('distribui os proventos entre meses diferentes, em vez de empilhar num só', () => {
		const workbook = buildMovementWorkbook([
			[
				'Credito',
				'15/01/2025',
				'Dividendo',
				'BBAS3 - BCO BRASIL',
				'BTG',
				'10',
				'0.5',
				'5.00',
			],
			[
				'Credito',
				'15/06/2025',
				'Dividendo',
				'BBAS3 - BCO BRASIL',
				'BTG',
				'10',
				'0.8',
				'8.00',
			],
			[
				'Credito',
				'15/11/2025',
				'Dividendo',
				'BBAS3 - BCO BRASIL',
				'BTG',
				'10',
				'1.2',
				'12.00',
			],
		]);

		const { dividendsBySymbol } = parseB3Workbook(workbook, REPORT_DATE);
		const meses = dividendsBySymbol
			.get('BBAS3')!
			.map((event) => event.eventDate.toISOString().slice(0, 7))
			.sort();

		expect(meses).toEqual(['2025-01', '2025-06', '2025-11']);
	});

	it('ignora movimentações que não são provento em dinheiro', () => {
		const workbook = buildMovementWorkbook([
			[
				'Credito',
				'10/03/2025',
				'Transferência - Liquidação',
				'PETR4 - PETROLEO',
				'BTG',
				'5',
				'30.00',
				'150.00',
			],
			[
				'Credito',
				'11/03/2025',
				'Atualização',
				'BEEF3 - MINERVA',
				'BTG',
				'74',
				' - ',
				' - ',
			],
			[
				'Debito',
				'12/03/2025',
				'Compra',
				'VALE3 - VALE',
				'BTG',
				'2',
				'60.00',
				'120.00',
			],
			[
				'Credito',
				'13/03/2025',
				'Dividendo',
				'PETR4 - PETROLEO',
				'BTG',
				'5',
				'0.4',
				'2.00',
			],
		]);

		const { dividendsBySymbol } = parseB3Workbook(workbook, REPORT_DATE);

		expect([...dividendsBySymbol.keys()]).toEqual(['PETR4']);
		expect(dividendsBySymbol.get('PETR4')![0].totalValue).toBe(2.0);
	});

	it('descarta estorno de provento (débito) e mantém o crédito', () => {
		const workbook = buildMovementWorkbook([
			[
				'Credito',
				'05/05/2025',
				'Rendimento',
				'IRIM11 - IRIDIUM',
				'BTG',
				'11',
				'0.77',
				'8.47',
			],
			[
				'Debito',
				'06/05/2025',
				'Rendimento',
				'IRIM11 - IRIDIUM',
				'BTG',
				'11',
				'0.77',
				'8.47',
			],
		]);

		const { dividendsBySymbol } = parseB3Workbook(workbook, REPORT_DATE);
		const eventos = dividendsBySymbol.get('IRIM11')!;

		expect(eventos).toHaveLength(1);
		expect(eventos[0].totalValue).toBe(8.47);
	});

	it('soma proventos do mesmo papel, tipo e dia num único evento', () => {
		const workbook = buildMovementWorkbook([
			[
				'Credito',
				'20/09/2025',
				'Dividendo',
				'VBBR3 - VIBRA',
				'BTG',
				'10',
				'1.00',
				'10.00',
			],
			[
				'Credito',
				'20/09/2025',
				'Dividendo',
				'VBBR3 - VIBRA',
				'BTG',
				'5',
				'1.00',
				'5.00',
			],
		]);

		const { dividendsBySymbol } = parseB3Workbook(workbook, REPORT_DATE);
		const eventos = dividendsBySymbol.get('VBBR3')!;

		expect(eventos).toHaveLength(1);
		expect(eventos[0].totalValue).toBe(15.0);
	});

	it('marca hasDatedDividends como false no consolidado anual, que não tem data', () => {
		const sheet = xlsx.utils.aoa_to_sheet([
			['Produto', 'Tipo de Evento', 'Valor líquido'],
			['BBAS3', 'Dividendo', '4.08'],
		]);
		const workbook = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(workbook, sheet, 'Proventos Recebidos');

		const { dividendsBySymbol, hasDatedDividends } = parseB3Workbook(
			workbook,
			REPORT_DATE
		);

		expect(hasDatedDividends).toBe(false);
		// Sem data no arquivo, o provento cai na data de referência do relatório.
		expect(
			dividendsBySymbol.get('BBAS3')![0].eventDate.toISOString().slice(0, 10)
		).toBe('2025-12-31');
	});
});
