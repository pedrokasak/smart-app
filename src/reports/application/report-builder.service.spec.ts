import { ReportBuilderService } from './report-builder.service';

/**
 * Relatório de risco (TRA-274): as métricas novas de performance precisam
 * chegar ao PDF, não só à API.
 */
describe('ReportBuilderService — relatório de risco', () => {
	const USER_ID = '507f1f77bcf86cd799439011';

	const returnsPayload = (overrides: Record<string, any> = {}) => ({
		from: '2025-01-02',
		to: '2025-12-30',
		twr: { value: 0.171, annualized: 0.171, periods: 240 },
		irr: 0.19,
		benchmark: {
			symbol: '^BVSP',
			label: 'IBOV',
			beta: 0.86,
			trackingError: 0.064,
			correlation: 0.8,
		},
		risk: {
			sharpe: { sharpe: 1.42, riskFreeAnnual: 0.102, observations: 240 },
			valueAtRisk: {
				varPct: 0.032,
				amount: 41180,
				cvarPct: 0.045,
				cvarAmount: 57900,
				horizonDays: 21,
				confidence: 0.95,
				windows: 220,
			},
			drawdown: {
				maxDrawdown: -0.142,
				peakDate: '2025-02-10',
				troughDate: '2025-03-14',
				durationDays: 24,
				recoveryDate: null,
				recoveryDays: null,
			},
		},
		performance: {
			cagr: 0.171,
			sortino: 2.1,
			calmar: 1.2,
			upCapture: 0.88,
			downCapture: 0.61,
			informationRatio: 0.45,
			monthly: [
				{
					period: '2025-01',
					portfolio: 0.02,
					cdi: 0.008,
					benchmark: 0.01,
					partial: true,
				},
				{
					period: '2025-02',
					portfolio: 0.03,
					cdi: 0.008,
					benchmark: 0.02,
					partial: false,
				},
			],
			annual: [
				{
					period: '2025',
					portfolio: 0.171,
					cdi: 0.102,
					benchmark: 0.146,
					partial: true,
				},
			],
			monthStats: {
				best: { period: '2025-02', value: 0.03, partial: false },
				worst: { period: '2025-03', value: -0.04, partial: false },
				positiveShare: 0.75,
				months: 8,
			},
			rolling12m: [{ period: '2025-12', value: 0.18 }],
		},
		...overrides,
	});

	const makeService = (returns = returnsPayload()) => {
		const lean = (value: unknown) => ({
			lean: jest.fn().mockResolvedValue(value),
		});
		const portfolioModel = {
			find: jest.fn().mockReturnValue({
				select: jest.fn().mockReturnValue(lean([{ _id: 'p1' }])),
			}),
		};
		const assetModel = {
			find: jest.fn().mockReturnValue(
				lean([
					{ symbol: 'PETR4', quantity: 100, currentPrice: 40 },
					{ symbol: 'ITUB4', quantity: 100, currentPrice: 40 },
				])
			),
		};
		const tradeModel = {
			find: jest.fn().mockReturnValue({
				sort: jest.fn().mockReturnValue(lean([])),
			}),
		};
		const returnsService = { getReturns: jest.fn().mockResolvedValue(returns) };
		const riskContributionService = {
			getRiskContribution: jest.fn().mockResolvedValue({
				rows: [],
				observations: 0,
				portfolioVolatility: 0.128,
				missingSymbols: [],
				excludedValuePct: 0,
				truncated: false,
			}),
		};
		return new ReportBuilderService(
			tradeModel as any,
			portfolioModel as any,
			assetModel as any,
			{} as any,
			returnsService as any,
			riskContributionService as any
		);
	};

	const metricValue = (doc: any, metric: string) =>
		doc.tables[0].rows.find((row: any) => row.metric === metric)?.value;

	it('inclui XIRR, Sortino, Calmar, captura e information ratio', async () => {
		const doc = await makeService().build(USER_ID, 'risk', 2025);

		expect(metricValue(doc, 'Retorno do seu dinheiro (XIRR)')).not.toBe('—');
		expect(metricValue(doc, 'Sortino (rf = CDI)')).toBe('2,10');
		expect(metricValue(doc, 'Calmar')).toBe('1,20');
		expect(metricValue(doc, 'Captura de alta vs IBOV')).not.toBe('—');
		expect(metricValue(doc, 'Captura de baixa vs IBOV')).not.toBe('—');
		expect(metricValue(doc, 'Information ratio')).toBe('0,45');
	});

	it('inclui melhor e pior mês, meses positivos e concentração', async () => {
		const doc = await makeService().build(USER_ID, 'risk', 2025);

		expect(metricValue(doc, 'Melhor mês')).toContain('2025-02');
		expect(metricValue(doc, 'Pior mês')).toContain('2025-03');
		expect(metricValue(doc, 'Meses positivos')).toContain('de 8');
		// Duas posições de mesmo valor: dois ativos efetivos.
		expect(metricValue(doc, 'Número efetivo de ativos')).toBe('2,0');
	});

	// Drawdown sem recuperação é informação, não lacuna.
	it('diz quando a carteira ainda não recuperou do pior drawdown', async () => {
		const doc = await makeService().build(USER_ID, 'risk', 2025);

		expect(metricValue(doc, 'Recuperação do drawdown')).toBe(
			'ainda não recuperou'
		);
	});

	it('traz as tabelas mensal, anual e de retorno móvel, com parcial marcado', async () => {
		const doc = await makeService().build(USER_ID, 'risk', 2025);
		const titles = doc.tables.map((table: any) => table.title);

		expect(titles).toEqual(
			expect.arrayContaining([
				'Rentabilidade mês a mês',
				'Rentabilidade por ano',
				'Retorno móvel de 12 meses',
			])
		);
		const monthly = doc.tables.find(
			(table: any) => table.title === 'Rentabilidade mês a mês'
		);
		expect(monthly.rows[0]).toEqual({
			period: '2025-01 (parcial)',
			portfolio: 0.02,
			cdi: 0.008,
			benchmark: 0.01,
		});
		expect(monthly.rows[1].period).toBe('2025-02');
	});
});
