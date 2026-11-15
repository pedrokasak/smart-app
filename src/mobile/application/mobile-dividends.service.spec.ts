import {
	DIVIDEND_AGENDA_DAYS,
	MobileDividendsService,
} from './mobile-dividends.service';

describe('MobileDividendsService', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	const portfolios = { getUserPortfolios: jest.fn() };
	const income = { insight: jest.fn() };
	const upcoming = { listUpcoming: jest.fn() };
	const service = new MobileDividendsService(
		portfolios as any,
		income as any,
		upcoming as any
	);

	beforeEach(() => {
		jest.resetAllMocks();
		portfolios.getUserPortfolios.mockResolvedValue([
			{
				_id: 'p1',
				assets: [
					{
						symbol: 'ITUB4',
						quantity: 100,
						dividendHistory: [{ date: '2026-11-03', value: 0.5 }],
					},
				],
			},
		]);
		income.insight.mockResolvedValue({
			facts: {
				total12m: 50,
				monthlyAvg: 4.17,
				yieldOnMarketPct: 1.2,
				yieldOnCostPct: 1.5,
				approximated: false,
				payers: [{ symbol: 'ITUB4', amount: 50, sharePct: 100 }],
			},
			didactic: {
				answer: 'R$ 50,00 em 12m.',
				meaning: 'Top pagadores.',
				whyItMatters: null,
			},
		});
		upcoming.listUpcoming.mockResolvedValue({
			windowDays: DIVIDEND_AGENDA_DAYS,
			totalNetValue: 63.5,
			items: [
				{
					symbol: 'ITUB4',
					paymentType: 'JCP',
					expectedPaymentDate: new Date('2026-11-24T00:00:00Z'),
					quantity: 100,
					unitValue: 0.635,
					netValue: 63.5,
				},
			],
		});
	});

	it('monta a tela com os números do serviço de renda e a agenda da B3', async () => {
		const result = await service.getDividends('u1', now);

		expect(income.insight).toHaveBeenCalledWith('u1', {
			level: 'intermediario',
		});
		expect(upcoming.listUpcoming).toHaveBeenCalledWith(
			'u1',
			['p1'],
			DIVIDEND_AGENDA_DAYS,
			now
		);
		expect(result.received12m).toBe(50);
		expect(result.months).toHaveLength(12);
		expect(result.months[11]).toEqual({ month: '2026-11', amount: 50 });
		expect(result.upcoming.items[0]).toEqual({
			symbol: 'ITUB4',
			paymentType: 'JCP',
			paymentDate: '2026-11-24',
			unitValue: 0.635,
			netValue: 63.5,
		});
	});

	it('usa o significado quando não há consequência para explicar', async () => {
		const result = await service.getDividends('u1', now);

		expect(result.insight).toEqual({
			headline: 'R$ 50,00 em 12m.',
			body: 'Top pagadores.',
		});
	});

	it('sem carteira, devolve tudo zerado em vez de falhar', async () => {
		portfolios.getUserPortfolios.mockResolvedValue(null);

		const result = await service.getDividends('u1', now);

		expect(upcoming.listUpcoming).toHaveBeenCalledWith(
			'u1',
			[],
			DIVIDEND_AGENDA_DAYS,
			now
		);
		expect(result.months.every((month) => month.amount === 0)).toBe(true);
	});
});
