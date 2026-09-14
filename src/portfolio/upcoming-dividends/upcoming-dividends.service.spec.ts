import { UpcomingDividendsService } from './upcoming-dividends.service';

const USER = '507f1f77bcf86cd799439011';
const PORTFOLIO = '507f1f77bcf86cd799439012';

function buildModel(records: any[] = []) {
	const query = {
		sort: jest.fn().mockReturnThis(),
		lean: jest.fn().mockResolvedValue(records),
	};
	return {
		deleteMany: jest.fn().mockResolvedValue({}),
		insertMany: jest.fn().mockResolvedValue([]),
		find: jest.fn().mockReturnValue(query),
		query,
	};
}

const event = (symbol: string, date: string, netValue: number) => ({
	symbol,
	paymentType: 'DIVIDEND' as const,
	expectedPaymentDate: new Date(`${date}T00:00:00.000Z`),
	quantity: 10,
	unitValue: netValue / 10,
	netValue,
});

describe('UpcomingDividendsService', () => {
	// O relatório de Eventos é uma foto dos pendentes: reimportar substitui,
	// nunca soma. O que foi pago sai da lista.
	it('replaces the pending events of the portfolio instead of appending', async () => {
		const model = buildModel();
		const service = new UpcomingDividendsService(model as any);

		const result = await service.replaceForPortfolio(USER, PORTFOLIO, [
			event('MOVI3', '2026-09-11', 14.39),
			event('BMGB4', '2026-09-04', 2.07),
		]);

		expect(model.deleteMany).toHaveBeenCalledTimes(1);
		const [owner] = model.deleteMany.mock.calls[0];
		expect(String(owner.userId)).toBe(USER);
		expect(String(owner.portfolioId)).toBe(PORTFOLIO);
		expect(model.insertMany.mock.calls[0][0]).toHaveLength(2);
		expect(result).toMatchObject({ eventsImported: 2, totalNetValue: 16.46 });
		expect(result.nextPaymentDate?.toISOString().slice(0, 10)).toBe(
			'2026-09-04'
		);
	});

	it('clears the list when the new report has no pending events', async () => {
		const model = buildModel();
		const service = new UpcomingDividendsService(model as any);

		await service.replaceForPortfolio(USER, PORTFOLIO, []);

		expect(model.deleteMany).toHaveBeenCalledTimes(1);
		expect(model.insertMany).not.toHaveBeenCalled();
	});

	it("lists only the user's portfolios within the window, from the start of today", async () => {
		const model = buildModel([
			{
				_id: 'a',
				portfolioId: PORTFOLIO,
				symbol: 'BMGB4',
				paymentType: 'JCP',
				expectedPaymentDate: new Date('2026-09-20'),
				quantity: 25,
				unitValue: 0.1,
				netValue: 2.07,
			},
			{
				_id: 'b',
				portfolioId: PORTFOLIO,
				symbol: 'MOVI3',
				paymentType: 'DIVIDEND',
				expectedPaymentDate: new Date('2026-10-01'),
				quantity: 32,
				unitValue: 0.53,
				netValue: 14.39,
			},
		]);
		const service = new UpcomingDividendsService(model as any);

		const summary = await service.listUpcoming(
			USER,
			[PORTFOLIO],
			45,
			new Date('2026-09-14T15:30:00.000Z')
		);

		const [filter] = model.find.mock.calls[0];
		expect(String(filter.userId)).toBe(USER);
		expect(filter.expectedPaymentDate.$gte.toISOString()).toBe(
			'2026-09-14T00:00:00.000Z'
		);
		expect(filter.expectedPaymentDate.$lte.toISOString()).toBe(
			'2026-10-29T00:00:00.000Z'
		);
		expect(summary).toMatchObject({ windowDays: 45, totalNetValue: 16.46 });
		expect(summary.items.map((item) => item.symbol)).toEqual([
			'BMGB4',
			'MOVI3',
		]);
	});

	it('does not query when the user has no portfolios and caps the window', async () => {
		const model = buildModel();
		const service = new UpcomingDividendsService(model as any);

		expect(await service.listUpcoming(USER, [], 45)).toEqual({
			windowDays: 45,
			totalNetValue: 0,
			items: [],
		});
		expect(model.find).not.toHaveBeenCalled();

		const capped = await service.listUpcoming(USER, [PORTFOLIO], 100000);
		expect(capped.windowDays).toBe(366);
	});
});
