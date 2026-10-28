import { FiscalService } from 'src/fiscal/fiscal.service';

describe('FiscalService', () => {
	const service = new FiscalService({
		calculate: jest.fn(),
	} as any);

	it('keeps requested quantity when within current position', () => {
		const result = service.normalizeSellQuantity(5, 10);
		expect(result.effectiveQuantity).toBe(5);
		expect(result.warning).toBeNull();
	});

	it('clamps requested quantity when above current position', () => {
		const result = service.normalizeSellQuantity(100, 8);
		expect(result.effectiveQuantity).toBe(8);
		expect(result.warning).toContain('Simulação ajustada');
	});

	it('returns zero when requested or current quantity is invalid', () => {
		expect(service.normalizeSellQuantity(0, 10).effectiveQuantity).toBe(0);
		expect(service.normalizeSellQuantity(10, 0).effectiveQuantity).toBe(0);
	});

	it('explains tax drivers by symbol when stock monthly sales exceed exemption', () => {
		const drivers = service.calculateTaxDrivers(
			[
				{
					assetSymbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 10,
					fees: 0,
					date: new Date('2026-01-01T00:00:00.000Z'),
				},
				{
					assetSymbol: 'PETR4',
					side: 'sell',
					quantity: 100,
					price: 250,
					fees: 0,
					date: new Date('2026-01-20T00:00:00.000Z'),
				},
			],
			{ PETR4: 'stock' }
		);

		expect(drivers[0].symbol).toBe('PETR4');
		expect(drivers[0].estimatedTax).toBeGreaterThan(0);
		expect(drivers[0].reason).toContain('tributável');
	});

	it('keeps estimated tax as zero for stock sells under monthly exemption', () => {
		const drivers = service.calculateTaxDrivers(
			[
				{
					assetSymbol: 'PETR4',
					side: 'buy',
					quantity: 100,
					price: 10,
					fees: 0,
					date: new Date('2026-01-01T00:00:00.000Z'),
				},
				{
					assetSymbol: 'PETR4',
					side: 'sell',
					quantity: 10,
					price: 50,
					fees: 0,
					date: new Date('2026-01-20T00:00:00.000Z'),
				},
			],
			{ PETR4: 'stock' }
		);

		expect(drivers[0].estimatedTax).toBe(0);
		expect(drivers[0].reason).toContain('isenção');
	});
	describe('calculateMonthlyTaxSummary', () => {
		const trade = (
			side: 'buy' | 'sell',
			quantity: number,
			price: number,
			date: string,
			assetSymbol = 'PETR4'
		) => ({
			assetSymbol,
			side,
			quantity,
			price,
			fees: 0,
			date: new Date(date),
		});

		it('compensates a previous stock loss before taxing and reports the breakdown', () => {
			const [loss, gain] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 1000, 50, '2026-01-02T12:00:00Z'),
					trade('sell', 500, 44, '2026-01-10T12:00:00Z'), // -3.000, vendas 22.000
					trade('sell', 500, 60, '2026-02-10T12:00:00Z'), // +5.000, vendas 30.000
				],
				{ PETR4: 'stock' }
			);

			expect(loss).toMatchObject({ stockTax: 0, accumulatedLoss: 3000 });
			expect(gain).toMatchObject({
				stockCompensatedLoss: 3000,
				stockTaxableBase: 2000,
				stockTax: 300,
				accumulatedLoss: 0,
			});
		});

		it('keeps the carried loss when the gain happens in an exempt month', () => {
			const [, exemptGain] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 1000, 50, '2026-01-02T12:00:00Z'),
					trade('sell', 500, 44, '2026-01-10T12:00:00Z'), // -3.000
					trade('sell', 100, 60, '2026-02-10T12:00:00Z'), // +1.000, vendas 6.000
				],
				{ PETR4: 'stock' }
			);

			expect(exemptGain).toMatchObject({
				stockExempt: true,
				stockTax: 0,
				stockCompensatedLoss: 0,
				accumulatedLoss: 3000,
			});
		});

		it('exempts crypto gains when monthly crypto sales stay under R$ 35 mil', () => {
			const [under, over] = service.calculateMonthlyTaxSummary(
				[
					trade('buy', 2, 20000, '2026-01-02T12:00:00Z', 'BTC'),
					trade('sell', 1, 30000, '2026-01-10T12:00:00Z', 'BTC'),
					trade('sell', 1, 40000, '2026-02-10T12:00:00Z', 'BTC'),
				],
				{ BTC: 'crypto' }
			);

			expect(under).toMatchObject({
				cryptoSales: 30000,
				cryptoExempt: true,
				cryptoTax: 0,
			});
			expect(over).toMatchObject({
				cryptoSales: 40000,
				cryptoExempt: false,
				cryptoTax: 3000,
			});
		});
	});

	// TRA-287: BOVA11 e IVVB11 são ETF, SANB11 é unit. A importação da B3 grava
	// `fii` para os três, então todos os casos passam o tipo gravado errado.
	describe('ETF e unit terminados em 11 (TRA-287)', () => {
		const trade = (
			assetSymbol: string,
			side: 'buy' | 'sell',
			quantity: number,
			price: number,
			date: string
		) => ({
			assetSymbol,
			side,
			quantity,
			price,
			fees: 0,
			date: new Date(date),
		});
		const typeFii = { BOVA11: 'fii', IVVB11: 'fii', SANB11: 'fii' };

		describe('categoria', () => {
			it.each(['BOVA11', 'IVVB11'])('%s gravado como fii é ETF', (symbol) => {
				expect(service.getCategoryForAsset(symbol, 'fii')).toBe('etf');
			});

			it('SANB11 gravado como fii é ação', () => {
				expect(service.getCategoryForAsset('SANB11', 'fii')).toBe('stock');
			});

			it('um FII de verdade continua FII', () => {
				expect(service.getCategoryForAsset('HGLG11', 'fii')).toBe('fii');
			});
		});

		describe('simulador de venda', () => {
			it('BOVA11: 15% e sem a isenção de R$ 20 mil, mesmo vendendo pouco', () => {
				const preview = service.estimateSaleTax({
					symbol: 'BOVA11',
					quantity: 100,
					sellPrice: 130,
					averagePrice: 100,
					monthStockSales: 0,
					assetType: 'fii',
				});

				expect(preview.category).toBe('etf');
				expect(preview.exempt).toBe(false);
				expect(preview.pnl).toBe(3000);
				expect(preview.tax).toBeCloseTo(450, 2);
			});

			it('SANB11: ação, com a isenção do mês', () => {
				const preview = service.estimateSaleTax({
					symbol: 'SANB11',
					quantity: 100,
					sellPrice: 40,
					averagePrice: 30,
					monthStockSales: 0,
					assetType: 'fii',
				});

				expect(preview.category).toBe('stock');
				expect(preview.exempt).toBe(true);
				expect(preview.tax).toBe(0);
			});

			it('HGLG11: FII a 20%, sem mudança', () => {
				const preview = service.estimateSaleTax({
					symbol: 'HGLG11',
					quantity: 10,
					sellPrice: 110,
					averagePrice: 100,
					monthStockSales: 0,
					assetType: 'fii',
				});

				expect(preview.category).toBe('fii');
				expect(preview.tax).toBeCloseTo(20, 2);
			});
		});

		describe('detalhe por ativo', () => {
			it('BOVA11 aparece como ETF, com 15%, sem isenção', () => {
				const [driver] = service.calculateTaxDrivers(
					[
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 130, '2026-01-10T12:00:00Z'),
					],
					typeFii
				);

				expect(driver.category).toBe('etf');
				expect(driver.taxRate).toBe(0.15);
				expect(driver.estimatedTax).toBeCloseTo(450, 2);
				expect(driver.reason).toContain('ETF');
			});

			it('SANB11 aparece como ação isenta no mês abaixo do limite', () => {
				const [driver] = service.calculateTaxDrivers(
					[
						trade('SANB11', 'buy', 100, 30, '2026-01-02T12:00:00Z'),
						trade('SANB11', 'sell', 100, 40, '2026-01-10T12:00:00Z'),
					],
					typeFii
				);

				expect(driver.category).toBe('stock');
				expect(driver.estimatedTax).toBe(0);
				expect(driver.reason).toContain('isenção');
			});
		});

		describe('apuração mensal', () => {
			it('lucro de ETF é tributado a 15% mesmo com vendas abaixo de R$ 20 mil', () => {
				const [month] = service.calculateMonthlyTaxSummary(
					[
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 130, '2026-01-10T12:00:00Z'),
					],
					typeFii
				);

				expect(month.etfSales).toBe(13000);
				expect(month.etfProfit).toBe(3000);
				expect(month.stockTaxableBase).toBe(3000);
				expect(month.stockTax).toBeCloseTo(450, 2);
				expect(month.totalTax).toBeCloseTo(450, 2);
				// Não era FII: nada vai para a coluna dos FIIs.
				expect(month.fiiProfit).toBe(0);
				expect(month.fiiTax).toBe(0);
			});

			it('SANB11 usa a isenção das ações e não paga como FII', () => {
				const [month] = service.calculateMonthlyTaxSummary(
					[
						trade('SANB11', 'buy', 100, 30, '2026-01-02T12:00:00Z'),
						trade('SANB11', 'sell', 100, 40, '2026-01-10T12:00:00Z'),
					],
					typeFii
				);

				expect(month.stockSales).toBe(4000);
				expect(month.stockProfit).toBe(1000);
				expect(month.stockExempt).toBe(true);
				expect(month.totalTax).toBe(0);
				expect(month.fiiProfit).toBe(0);
			});

			it('venda de ETF não consome o limite de R$ 20 mil das ações', () => {
				const [month] = service.calculateMonthlyTaxSummary(
					[
						trade('PETR4', 'buy', 1000, 10, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 1000, 12, '2026-01-10T12:00:00Z'), // 12.000, +2.000
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 105, '2026-01-12T12:00:00Z'), // 10.500, +500
					],
					{ PETR4: 'stock', BOVA11: 'fii' }
				);

				// 12.000 + 10.500 passaria de 20.000 se o ETF contasse como ação.
				expect(month.stockSales).toBe(12000);
				expect(month.stockExempt).toBe(true);
				// O lucro da ação é isento; só o do ETF paga: 500 x 15%.
				expect(month.stockTax).toBeCloseTo(75, 2);
			});

			it('prejuízo de ação compensa lucro de ETF no mês seguinte', () => {
				const [loss, gain] = service.calculateMonthlyTaxSummary(
					[
						trade('PETR4', 'buy', 1000, 50, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 500, 44, '2026-01-10T12:00:00Z'), // -3.000
						trade('BOVA11', 'buy', 100, 100, '2026-01-03T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 150, '2026-02-10T12:00:00Z'), // +5.000
					],
					{ PETR4: 'stock', BOVA11: 'fii' }
				);

				expect(loss.accumulatedLoss).toBe(3000);
				expect(gain.stockCompensatedLoss).toBe(3000);
				expect(gain.stockTaxableBase).toBe(2000);
				expect(gain.stockTax).toBeCloseTo(300, 2);
				expect(gain.accumulatedLoss).toBe(0);
			});

			it('prejuízo de ETF compensa lucro de ação fora do mês isento', () => {
				const [, gain] = service.calculateMonthlyTaxSummary(
					[
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 80, '2026-01-10T12:00:00Z'), // -2.000
						trade('PETR4', 'buy', 1000, 10, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 1000, 30, '2026-02-10T12:00:00Z'), // +20.000, vendas 30.000
					],
					{ PETR4: 'stock', BOVA11: 'fii' }
				);

				expect(gain.stockExempt).toBe(false);
				expect(gain.stockCompensatedLoss).toBe(2000);
				expect(gain.stockTaxableBase).toBe(18000);
			});

			it('prejuízo de FII não compensa lucro de ETF', () => {
				const [loss, gain] = service.calculateMonthlyTaxSummary(
					[
						trade('HGLG11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('HGLG11', 'sell', 100, 90, '2026-01-10T12:00:00Z'), // -1.000
						trade('BOVA11', 'buy', 100, 100, '2026-01-03T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 120, '2026-02-10T12:00:00Z'), // +2.000
					],
					{ HGLG11: 'fii', BOVA11: 'fii' }
				);

				expect(loss.accumulatedLoss).toBe(1000);
				expect(gain.stockCompensatedLoss).toBe(0);
				expect(gain.stockTax).toBeCloseTo(300, 2);
				// O prejuízo do FII segue guardado, sem ter sido usado.
				expect(gain.accumulatedLoss).toBe(1000);
			});

			it('no mesmo mês, prejuízo de ação (mês isento) abate o lucro de ETF', () => {
				const [month] = service.calculateMonthlyTaxSummary(
					[
						trade('PETR4', 'buy', 100, 50, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 100, 40, '2026-01-10T12:00:00Z'), // -1.000, vendas 4.000
						trade('BOVA11', 'buy', 100, 100, '2026-01-03T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 130, '2026-01-12T12:00:00Z'), // +3.000
					],
					{ PETR4: 'stock', BOVA11: 'fii' }
				);

				expect(month.stockTaxableBase).toBe(2000);
				expect(month.stockTax).toBeCloseTo(300, 2);
			});

			it('sem ETF na carteira, o resultado é o mesmo de antes', () => {
				const [month] = service.calculateMonthlyTaxSummary(
					[
						trade('PETR4', 'buy', 1000, 10, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 1000, 30, '2026-01-10T12:00:00Z'), // +20.000, vendas 30.000
					],
					{ PETR4: 'stock' }
				);

				expect(month.etfSales).toBe(0);
				expect(month.etfProfit).toBe(0);
				expect(month.stockTaxableBase).toBe(20000);
				expect(month.stockTax).toBeCloseTo(3000, 2);
				expect(month.stockCompensatedLoss).toBe(0);
			});
		});

		describe('prejuízo acumulado', () => {
			it('o prejuízo de ETF entra no pool das ações, não no dos FIIs', () => {
				const losses = service.calculateAccumulatedLosses(
					[
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 80, '2026-01-10T12:00:00Z'),
					],
					typeFii
				);

				expect(losses).toEqual({ stock: 2000, fii: 0, crypto: 0, total: 2000 });
			});

			it('lucro de ação desconta o prejuízo de ETF no pool', () => {
				const losses = service.calculateAccumulatedLosses(
					[
						trade('BOVA11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('BOVA11', 'sell', 100, 80, '2026-01-10T12:00:00Z'), // -2.000
						trade('PETR4', 'buy', 100, 10, '2026-01-02T12:00:00Z'),
						trade('PETR4', 'sell', 100, 60, '2026-01-12T12:00:00Z'), // +5.000
					],
					{ PETR4: 'stock', BOVA11: 'fii' }
				);

				expect(losses.stock).toBe(0);
			});

			it('o prejuízo de FII continua separado', () => {
				const losses = service.calculateAccumulatedLosses(
					[
						trade('HGLG11', 'buy', 100, 100, '2026-01-02T12:00:00Z'),
						trade('HGLG11', 'sell', 100, 90, '2026-01-10T12:00:00Z'),
					],
					{ HGLG11: 'fii' }
				);

				expect(losses).toEqual({ stock: 0, fii: 1000, crypto: 0, total: 1000 });
			});
		});
	});
});
