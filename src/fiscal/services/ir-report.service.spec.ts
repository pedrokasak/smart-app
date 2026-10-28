import { Types } from 'mongoose';
import { IrReportService } from './ir-report.service';

const USER_ID = new Types.ObjectId().toString();
const PORTFOLIO_ID = new Types.ObjectId();

const chain = <T>(value: T) => {
	const query: Record<string, jest.Mock> = {};
	query.select = jest.fn().mockReturnValue(query);
	query.sort = jest.fn().mockReturnValue(query);
	query.lean = jest.fn().mockResolvedValue(value);
	return query;
};

const buildService = (trades: unknown[], assets: unknown[]) => {
	const tradeModel = { find: jest.fn().mockReturnValue(chain(trades)) };
	const portfolioModel = {
		find: jest.fn().mockReturnValue(chain([{ _id: PORTFOLIO_ID }])),
	};
	const assetModel = { find: jest.fn().mockReturnValue(chain(assets)) };
	return new IrReportService(
		tradeModel as never,
		portfolioModel as never,
		assetModel as never
	);
};

const trade = (
	symbol: string,
	side: 'buy' | 'sell',
	quantity: number,
	price: number,
	date: string
) => ({ symbol, side, quantity, price, fees: 0, date: new Date(date) });

describe('IrReportService.generateIrReport', () => {
	it('tira o JCP do total de dividendos e o lista à parte', async () => {
		const service = buildService(
			[],
			[
				{
					symbol: 'ITSA4',
					type: 'stock',
					dividendHistory: [
						{ date: '2026-03-10', value: 10, paymentType: 'DIVIDEND' },
						{ date: '2026-06-10', value: 4, paymentType: 'JCP' },
					],
				},
			]
		);

		const report = await service.generateIrReport(USER_ID, 2026);

		expect(report.dividendsTotal).toBe(10);
		expect(report.jcpTotal).toBe(4);
		expect(report.jcp).toEqual([{ symbol: 'ITSA4', total: 4 }]);
		expect(report.notes.join(' ')).toContain('JCP:');
	});

	it('avisa quando não há JCP lançado', async () => {
		const service = buildService([], []);

		const report = await service.generateIrReport(USER_ID, 2026);

		expect(report.jcp).toEqual([]);
		expect(report.jcpTotal).toBe(0);
		expect(report.notes.join(' ')).toContain('Nenhum JCP lançado em 2026');
	});

	it('sinaliza histórico incompleto na resposta e nas notas', async () => {
		const service = buildService(
			[
				trade('BOVA11', 'buy', 10, 100, '2026-01-10'),
				trade('BOVA11', 'sell', 25, 120, '2026-02-10'),
			],
			[{ symbol: 'BOVA11', type: 'stock', dividendHistory: [] }]
		);

		const report = await service.generateIrReport(USER_ID, 2026);

		expect(report.incompleteHistory).toEqual([
			{
				symbol: 'BOVA11',
				missingQuantity: 15,
				firstShortfallDate: '2026-02-10',
			},
		]);
		expect(report.notes.join(' ')).toContain('Histórico incompleto em BOVA11');
	});

	it('não sinaliza nada quando o histórico fecha', async () => {
		const service = buildService(
			[
				trade('PETR4', 'buy', 10, 30, '2026-01-10'),
				trade('PETR4', 'sell', 10, 35, '2026-02-10'),
			],
			[{ symbol: 'PETR4', type: 'stock', dividendHistory: [] }]
		);

		const report = await service.generateIrReport(USER_ID, 2026);

		expect(report.incompleteHistory).toEqual([]);
		expect(report.notes.join(' ')).not.toContain('Histórico incompleto');
	});
});
