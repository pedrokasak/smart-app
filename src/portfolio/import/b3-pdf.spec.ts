import { classifyB3PdfText, parseB3NegotiationPdfText } from './b3-pdf';

// Trecho real do Extrato de Negociação exportado em PDF pela B3 (tabs incluídas).
const NEGOTIATION = [
	'FULANO DE TAL | CPF/CNPJ: 00000000000',
	'Filtros aplicados',
	'Data Inicial: 01/01/2025 | Data Final: 11/09/2026',
	'14 de agosto de 2026',
	'Código \tMercado \tVencimento Instituição Código de',
	'negociação Quantidade \tPreço \tValor',
	'Compra Mercado Fracionário \tBANCO BTG PACTUAL S/A. SAPR4F \t5 \tR$ 6,50 R$ 32,50',
	'Total Compra',
	'R$ 32,50',
	'22 de julho de 2026',
	'Compra Mercado Fracionário \tBANCO BTG PACTUAL S/A. BMGB4F \t3 \tR$ 5,29 R$ 15,87',
	'Compra Mercado à Vista \tBANCO BTG PACTUAL S/A. IRIM11 \t1 \tR$ 65,44 R$ 65,44',
	'Venda Mercado à Vista \tBANCO BTG PACTUAL S/A. PETR4 \t1.200 \tR$ 1.041,28 R$ 1.249.536,00',
	'Extrato de Negociação - Detalhe',
	'acesse investidor.B3.com.br \t1/10',
].join('\n');

describe('B3 PDF import', () => {
	it('classifies the B3 exports and ignores other PDFs', () => {
		expect(classifyB3PdfText(NEGOTIATION)).toBe('negotiation');
		expect(
			classifyB3PdfText(
				'Filtros aplicados\nExtrato de Movimentação\nacesse investidor.B3.com.br'
			)
		).toBe('movement');
		expect(
			classifyB3PdfText(
				'Filtros aplicados\nPosição - Ações\nacesse investidor.B3.com.br'
			)
		).toBe('position');
		expect(classifyB3PdfText('NOTA DE CORRETAGEM\nBTG Pactual')).toBe(
			'unknown'
		);
	});

	it('reads each trade line with its date, dropping the fractional F suffix', () => {
		const trades = parseB3NegotiationPdfText(NEGOTIATION);

		expect(trades).toEqual([
			{
				symbol: 'SAPR4',
				side: 'buy',
				quantity: 5,
				price: 6.5,
				fees: 0,
				date: new Date('2026-08-14T00:00:00Z'),
			},
			{
				symbol: 'BMGB4',
				side: 'buy',
				quantity: 3,
				price: 5.29,
				fees: 0,
				date: new Date('2026-07-22T00:00:00Z'),
			},
			{
				symbol: 'IRIM11',
				side: 'buy',
				quantity: 1,
				price: 65.44,
				fees: 0,
				date: new Date('2026-07-22T00:00:00Z'),
			},
			{
				symbol: 'PETR4',
				side: 'sell',
				quantity: 1200,
				price: 1041.28,
				fees: 0,
				date: new Date('2026-07-22T00:00:00Z'),
			},
		]);
	});

	it('ignores trade-looking lines before any date heading', () => {
		expect(
			parseB3NegotiationPdfText(
				'Compra Mercado à Vista BANCO X ITUB4 10 R$ 30,00 R$ 300,00'
			)
		).toEqual([]);
	});
});
