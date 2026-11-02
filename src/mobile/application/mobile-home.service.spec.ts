import {
	HOME_SECTION_TIMEOUT_MS,
	MobileHomeService,
} from './mobile-home.service';

describe('MobileHomeService', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	const asset = (fields: object) => ({
		_id: 'a1',
		portfolioId: 'p1',
		symbol: 'X',
		...fields,
	});
	const portfolios = { getUserPortfolios: jest.fn() };
	const returns = { getReturnsSummary: jest.fn(), getReturns: jest.fn() };
	const marks = { apply: jest.fn() };
	const composition = { getComposition: jest.fn() };
	const upcoming = { listUpcoming: jest.fn() };
	const service = new MobileHomeService(
		portfolios as any,
		returns as any,
		composition as any,
		upcoming as any,
		marks as any
	);

	beforeEach(() => {
		jest.resetAllMocks();
		portfolios.getUserPortfolios.mockResolvedValue([
			{
				_id: 'p1',
				assets: [asset({ type: 'stock', quantity: 10, price: 10, total: 100 })],
			},
		]);
		returns.getReturnsSummary.mockResolvedValue({
			currentValue: 1000,
			twr: 0.12,
			asOf: '2026-11-09',
			staleDays: 2,
		});
		marks.apply.mockImplementation(async (assets) => assets);
		composition.getComposition.mockResolvedValue({
			yield: {
				portfolioYieldOnMarket: 0.07,
				portfolioYieldOnCost: 0.09,
				approximated: true,
			},
		});
		upcoming.listUpcoming.mockResolvedValue({
			totalNetValue: 250,
			items: [{}, {}],
		});
	});

	it('compõe os blocos sem calcular valor financeiro', async () => {
		const home = await service.getHome('u1', now);

		expect(home.patrimony).toEqual({
			totalValue: 1000,
			twr12m: 0.12,
			asOf: '2026-11-09',
			staleDays: 2,
		});
		expect(home.dividends).toEqual({ totalNetValue: 250, payments: 2 });
		expect(home.yield).toEqual({
			onMarket: 0.07,
			onCost: 0.09,
			approximated: true,
		});
		expect(home.unavailable).toEqual([]);
	});

	it('pede os retornos de 12 meses e os proventos até o fim do mês', async () => {
		await service.getHome('u1', now);

		expect(returns.getReturnsSummary).toHaveBeenCalledWith('u1', {
			from: '2025-11-10',
		});
		expect(returns.getReturns).not.toHaveBeenCalled();
		expect(upcoming.listUpcoming).toHaveBeenCalledWith('u1', ['p1'], 20, now);
	});

	it('no último dia do mês ainda consulta o próprio dia', async () => {
		await service.getHome('u1', new Date('2026-11-30T12:00:00Z'));

		expect(upcoming.listUpcoming.mock.calls[0][2]).toBe(1);
	});

	it('a alocação traz todos os baldes, sem meta configurada', async () => {
		const home = await service.getHome('u1', now);

		expect(home.allocation!.length).toBeGreaterThan(0);
		for (const entry of home.allocation!) {
			expect(typeof entry.bucket).toBe('string');
			expect(Number.isFinite(entry.pct)).toBe(true);
		}
		expect(JSON.stringify(home.allocation)).not.toContain('amount');
	});

	it('a alocação usa a mesma marcação a mercado do web', async () => {
		portfolios.getUserPortfolios.mockResolvedValue([
			{
				_id: 'p1',
				assets: [
					asset({ type: 'crypto', quantity: 1, price: 1000, total: 1000 }),
					asset({ type: 'stock', quantity: 100, price: 100, total: 10000 }),
				],
			},
		]);
		marks.apply.mockImplementation(async (assets) =>
			assets.map((entry: any) => ({ ...entry, total: 10000 }))
		);

		const home = await service.getHome('u1', now);

		expect(marks.apply).toHaveBeenCalledTimes(1);
		const pctOf = (bucket: string) =>
			home.allocation!.find((entry) => entry.bucket === bucket)?.pct;
		expect(pctOf('crypto')).toBeCloseTo(50, 0);
		expect(pctOf('stocks')).toBeCloseTo(50, 0);
	});

	it('falha na alocação não derruba a tela', async () => {
		marks.apply.mockRejectedValue(new Error('down'));

		const home = await service.getHome('u1', now);

		expect(home.allocation).toBeNull();
		expect(home.unavailable).toEqual(['allocation_failed']);
		expect(home.patrimony).not.toBeNull();
	});

	it('bloco lento vira lacuna, sem segurar o resto', async () => {
		jest.useFakeTimers();
		returns.getReturnsSummary.mockReturnValue(new Promise(() => undefined));

		const pending = service.getHome('u1', now);
		await jest.advanceTimersByTimeAsync(HOME_SECTION_TIMEOUT_MS + 1);
		const home = await pending;
		jest.useRealTimers();

		expect(home.patrimony).toBeNull();
		expect(home.unavailable).toEqual(['patrimony_failed']);
		expect(home.dividends).not.toBeNull();
	});

	it.each([
		['patrimony', () => returns.getReturnsSummary],
		['yield', () => composition.getComposition],
		['dividends', () => upcoming.listUpcoming],
	])('falha em %s não derruba a tela', async (name, mock) => {
		mock().mockRejectedValue(new Error('down'));

		const home: any = await service.getHome('u1', now);

		expect(home[name]).toBeNull();
		expect(home.unavailable).toEqual([`${name}_failed`]);
		expect(home.allocation).not.toBeNull();
	});

	it('sem as carteiras, não afirma que não há proventos nem alocação', async () => {
		portfolios.getUserPortfolios.mockRejectedValue(new Error('down'));

		const home = await service.getHome('u1', now);

		expect(home.dividends).toBeNull();
		expect(home.allocation).toBeNull();
		expect(home.patrimony).not.toBeNull();
		expect(home.unavailable).toEqual(
			expect.arrayContaining([
				'portfolios_failed',
				'dividends_failed',
				'allocation_failed',
			])
		);
	});

	it('usuário sem carteira recebe proventos e alocação zerados', async () => {
		portfolios.getUserPortfolios.mockResolvedValue([]);
		upcoming.listUpcoming.mockResolvedValue({ totalNetValue: 0, items: [] });

		const home = await service.getHome('u1', now);

		expect(home.dividends).toEqual({ totalNetValue: 0, payments: 0 });
		expect(home.unavailable).toEqual([]);
	});
});
