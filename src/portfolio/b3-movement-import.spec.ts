import * as xlsx from 'xlsx';
import {
	hasB3ReportSheet,
	hasB3UpcomingEventsSheet,
	parseB3UpcomingEvents,
	parseB3Workbook,
} from './portfolio.controller';

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

/**
 * `import-b3-auto` escolhe o importador por `hasB3ReportSheet`: posição,
 * provento ou movimentação → importador de relatório; nada disso → extrato
 * de negociação. A tela "Adicionar ativo" manda os três arquivos da B3 por
 * essa porta.
 */
describe('hasB3ReportSheet', () => {
	const workbookFrom = (sheetName: string, rows: any[][]) => {
		const workbook = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(
			workbook,
			xlsx.utils.aoa_to_sheet(rows),
			sheetName
		);
		return workbook;
	};

	it('is false for the "Negociação" export, so it goes to the transactions importer', () => {
		const workbook = workbookFrom('Negociação', [
			[
				'Data do Negócio',
				'Tipo de Movimentação',
				'Mercado',
				'Prazo/Vencimento',
				'Instituição',
				'Código de Negociação',
				'Quantidade',
				'Preço',
				'Valor',
			],
			[
				'14/08/2026',
				'Compra',
				'Mercado Fracionário',
				'-',
				'BTG',
				'SAPR4F',
				5,
				6.5,
				32.5,
			],
		]);

		expect(hasB3ReportSheet(workbook)).toBe(false);
	});

	it('is true for the "Movimentação" export', () => {
		expect(
			hasB3ReportSheet(
				buildMovementWorkbook([
					[
						'Credito',
						'10/08/2026',
						'Dividendo',
						'BBAS3 - BANCO DO BRASIL',
						'BTG',
						69,
						0.2,
						13.8,
					],
				])
			)
		).toBe(true);
	});

	it('is true for the annual consolidated report', () => {
		const workbook = workbookFrom('Posição - Ações', [
			[
				'Produto',
				'Instituição',
				'Conta',
				'Código de Negociação',
				'CNPJ da Empresa',
				'Quantidade',
				'Preço de Fechamento',
				'Valor Atualizado',
			],
			[
				'BBAS3 - BCO BRASIL S.A.',
				'BTG',
				'1',
				'BBAS3',
				'00000000000191',
				69,
				21.92,
				1512.48,
			],
		]);

		expect(hasB3ReportSheet(workbook)).toBe(true);
	});
});

/**
 * Relatório "Eventos" da B3 — aba "Proventos a Receber". Cabeçalhos copiados
 * do arquivo real exportado pela B3.
 */
describe('relatório de Eventos (proventos a receber)', () => {
	const buildEventsWorkbook = (rows: any[][]) => {
		const workbook = xlsx.utils.book_new();
		xlsx.utils.book_append_sheet(
			workbook,
			xlsx.utils.aoa_to_sheet([
				[
					'Produto',
					'Tipo',
					'Tipo de Evento',
					'Previsão de pagamento',
					'Instituição',
					'Conta',
					'Quantidade',
					'Preço unitário',
					'Valor líquido',
				],
				...rows,
			]),
			'Proventos a Receber'
		);
		return workbook;
	};

	const events = buildEventsWorkbook([
		[
			'BMGB4 - BANCO BMG S/A',
			'PN',
			'JUROS SOBRE CAPITAL PRÓPRIO',
			'04/09/2026',
			'BTG',
			'1',
			'25',
			0.1,
			2.07,
		],
		[
			'MOVI3 - MOVIDA',
			'ON',
			'DIVIDENDO',
			'11/09/2026',
			'BTG',
			'1',
			'32',
			0.53,
			14.39,
		],
		['XPTO3 - SEM DATA', 'ON', 'DIVIDENDO', '', 'BTG', '1', '10', 1, 10],
	]);

	// Regressão: com "Tipo de Evento" + "Valor líquido" a aba era lida como
	// proventos RECEBIDOS, e cada pagamento previsto virava histórico pago.
	it('never turns pending events into received dividends', () => {
		const { dividendsBySymbol, assets } = parseB3Workbook(events, REPORT_DATE);

		expect(dividendsBySymbol.size).toBe(0);
		expect(assets).toHaveLength(0);
		expect(hasB3ReportSheet(events)).toBe(false);
		expect(hasB3UpcomingEventsSheet(events)).toBe(true);
	});

	it('parses each pending payment with its expected date, type and net value', () => {
		const parsed = parseB3UpcomingEvents(events);

		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toMatchObject({
			symbol: 'BMGB4',
			paymentType: 'JCP',
			quantity: 25,
			unitValue: 0.1,
			netValue: 2.07,
		});
		expect(parsed[0].expectedPaymentDate.toISOString().slice(0, 10)).toBe(
			'2026-09-04'
		);
		expect(parsed[1]).toMatchObject({
			symbol: 'MOVI3',
			paymentType: 'DIVIDEND',
		});
	});
});
