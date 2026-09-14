import * as xlsx from 'xlsx';
import { BrokerSyncController } from './broker-sync.controller';

function buildXlsxBuffer(sheetName: string, rows: Record<string, unknown>[]) {
	const workbook = xlsx.utils.book_new();
	const sheet = xlsx.utils.json_to_sheet(rows);
	xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
	return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('BrokerSyncController - parseTradesFromXlsx', () => {
	const controller = new BrokerSyncController(
		{} as any,
		{} as any,
		{} as any,
		{} as any,
		{} as any
	);

	function parse(buffer: Buffer): any[] {
		return (controller as any).parseTradesFromXlsx(buffer);
	}

	// Regressão: a exportação "Negociação" real da B3 usa "Data do Negócio" e
	// "Tipo de Movimentação" — o parser antigo só reconhecia "Data"/"Data
	// Negócio" e "C/V"/"Tipo"/"Compra/Venda", nenhum dos quais existe nesse
	// arquivo. Resultado: todo upload de nota de negociação real extraía 0
	// trades, mesmo com dados válidos (era a causa do "Adicionar Ativo" não
	// sincronizar mais a carteira via B3).
	it('parses trades from the real B3 "Negociação" export column layout', () => {
		const buffer = buildXlsxBuffer('Negociação', [
			{
				'Data do Negócio': '14/08/2026',
				'Tipo de Movimentação': 'Compra',
				Mercado: 'Mercado Fracionário',
				'Prazo/Vencimento': '-',
				Instituição: 'BANCO BTG PACTUAL S/A.',
				'Código de Negociação': 'SAPR4F',
				Quantidade: 5,
				Preço: 6.5,
				Valor: 32.5,
			},
			{
				'Data do Negócio': '20/08/2026',
				'Tipo de Movimentação': 'Venda',
				Mercado: 'Mercado à Vista',
				'Prazo/Vencimento': '-',
				Instituição: 'BANCO BTG PACTUAL S/A.',
				'Código de Negociação': 'PETR4',
				Quantidade: 100,
				Preço: 38.2,
				Valor: 3820,
			},
		]);

		const trades = parse(buffer);

		expect(trades).toHaveLength(2);
		expect(trades[0]).toMatchObject({
			assetSymbol: 'SAPR4',
			side: 'buy',
			quantity: 5,
			price: 6.5,
		});
		expect(trades[1]).toMatchObject({
			assetSymbol: 'PETR4',
			side: 'sell',
			quantity: 100,
			price: 38.2,
		});
	});

	it('extracts buy/sell rows from the "Movimentação" export when a ticker column is present', () => {
		const buffer = buildXlsxBuffer('Movimentação', [
			{
				'Entrada/Saída': 'Credito',
				Data: '24/08/2026',
				Movimentação: 'Compra',
				'Código de Negociação': 'BEEF3',
				Produto: 'BEEF3 - MINERVA S.A.',
				Instituição: 'BANCO BTG PACTUAL S/A.',
				Quantidade: 74,
				'Preço unitário': 8.5,
				'Valor da Operação': 629,
			},
		]);

		const trades = parse(buffer);

		expect(trades).toHaveLength(1);
		expect(trades[0]).toMatchObject({
			assetSymbol: 'BEEF3',
			side: 'buy',
			quantity: 74,
		});
	});

	// A exportação "Movimentação" sem coluna de código explícito mistura
	// Tesouro Direto e outros eventos; "Produto" nesse caso é texto livre
	// ("Tesouro IPCA+ 2032") e nunca deve virar um símbolo de ativo inventado.
	it('does not fabricate a trade from non-ticker "Movimentação" rows (e.g. Tesouro Direto)', () => {
		const buffer = buildXlsxBuffer('Movimentação', [
			{
				'Entrada/Saída': 'Credito',
				Data: '10/08/2026',
				Movimentação: 'Compra',
				Produto: 'Tesouro IPCA+ 2032',
				Instituição: 'BANCO BTG PACTUAL S/A.',
				Quantidade: 0.07,
				'Preço unitário': 2966.08,
				'Valor da Operação': 207.63,
			},
		]);

		expect(parse(buffer)).toHaveLength(0);
	});

	it('skips non-trade "Movimentação" rows (dividends, bonus, transfers) even with a ticker column', () => {
		const buffer = buildXlsxBuffer('Movimentação', [
			{
				'Entrada/Saída': 'Credito',
				Data: '10/08/2026',
				Movimentação: 'Dividendo',
				'Código de Negociação': 'BBAS3',
				Produto: 'BBAS3 - BCO BRASIL S.A.',
				Instituição: 'BANCO BTG PACTUAL S/A.',
				Quantidade: 69,
				'Preço unitário': '-',
				'Valor da Operação': 12.4,
			},
		]);

		expect(parse(buffer)).toHaveLength(0);
	});

	// Regressão: "14/08/2026" é DD/MM/AAAA, mas `new Date(string)` assume
	// MM/DD/AAAA — dia 14 não existe como mês e vira Invalid Date, descartando
	// a linha inteira. Isso sozinho já derrubava toda nota real da B3 (a
	// maioria das negociações cai em dias > 12).
	it('parses B3-formatted DD/MM/YYYY dates correctly instead of misreading them as MM/DD/YYYY', () => {
		const buffer = buildXlsxBuffer('Negociação', [
			{
				'Data do Negócio': '14/08/2026',
				'Tipo de Movimentação': 'Compra',
				'Código de Negociação': 'PETR4',
				Quantidade: 10,
				Preço: 38.2,
			},
		]);

		const trades = parse(buffer);

		expect(trades).toHaveLength(1);
		expect(trades[0].date.toISOString().slice(0, 10)).toBe('2026-08-14');
	});
});

describe('BrokerSyncController - parsePositionsFromXlsx', () => {
	const controller = new BrokerSyncController(
		{} as any,
		{} as any,
		{} as any,
		{} as any,
		{} as any
	);

	function parsePositions(buffer: Buffer): any[] {
		return (controller as any).parsePositionsFromXlsx(buffer);
	}

	// O "Relatório consolidado" não tem negociações, só a posição atual
	// (planilhas "Posição - ..."). Sem este caminho o terceiro arquivo que a
	// B3 disponibiliza nunca sincronizava nada.
	it('extracts current holdings from "Posição - *" sheets', () => {
		const buffer = buildXlsxBuffer('Posição - Ações', [
			{
				Produto: 'BBAS3 - BCO BRASIL S.A.',
				'Código de Negociação': 'BBAS3',
				Quantidade: 69,
				'Quantidade Disponível': 69,
				'Preço de Fechamento': 21.92,
				'Valor Atualizado': 1512.48,
			},
		]);

		const positions = parsePositions(buffer);

		expect(positions).toHaveLength(1);
		expect(positions[0]).toMatchObject({
			symbol: 'BBAS3',
			quantity: 69,
			price: 21.92,
		});
	});

	it('ignores sheets that are not a "Posição" sheet', () => {
		const buffer = buildXlsxBuffer('Proventos Recebidos', [
			{
				Produto: 'AURE3',
				'Tipo de Evento': 'Dividendo',
				'Valor líquido': 1.36,
			},
		]);

		expect(parsePositions(buffer)).toHaveLength(0);
	});
});

describe('BrokerSyncController - resolveImportPortfolio', () => {
	// Regressão: a carteira era criada com o slug cru do provider ("b3"), e
	// Portfolio.name exige no mínimo 3 caracteres — todo upload de nota da B3
	// falhava com "Portfolio validation failed: name ... shorter than the
	// minimum allowed length (3)".
	it('creates the import portfolio with a display name that satisfies the 3-char minimum', async () => {
		const portfolioService = {
			findPortfolioByName: jest.fn().mockResolvedValue(null),
			createPortfolio: jest.fn().mockResolvedValue({ _id: 'p1' }),
		};
		const controller = new BrokerSyncController(
			{} as any,
			{} as any,
			portfolioService as any,
			{} as any,
			{} as any
		);

		await (controller as any).resolveImportPortfolio('user-1', 'b3');

		const [, dto] = portfolioService.createPortfolio.mock.calls[0];
		expect(dto.name).toBe('Carteira B3');
		expect(dto.name.length).toBeGreaterThanOrEqual(3);
	});

	it('reuses an existing portfolio instead of creating a duplicate', async () => {
		const existing = { _id: 'existing' };
		const portfolioService = {
			findPortfolioByName: jest
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(existing),
			createPortfolio: jest.fn(),
		};
		const controller = new BrokerSyncController(
			{} as any,
			{} as any,
			portfolioService as any,
			{} as any,
			{} as any
		);

		const result = await (controller as any).resolveImportPortfolio(
			'user-1',
			'b3'
		);

		expect(result).toBe(existing);
		expect(portfolioService.createPortfolio).not.toHaveBeenCalled();
	});
});
