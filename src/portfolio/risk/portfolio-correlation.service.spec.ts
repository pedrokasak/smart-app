import { PortfolioCorrelationService } from './portfolio-correlation.service';

describe('PortfolioCorrelationService', () => {
	const closes = (n: number, amplitude: number) => {
		const out: { date: string; close: number }[] = [];
		const cursor = new Date(Date.UTC(2025, 0, 6));
		let price = 100;
		while (out.length < n) {
			const weekday = cursor.getUTCDay();
			if (weekday !== 0 && weekday !== 6) {
				price *= 1 + (out.length % 2 === 0 ? amplitude : -amplitude * 0.9);
				out.push({ date: cursor.toISOString().slice(0, 10), close: price });
			}
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		return out;
	};

	const makeService = (assets: any[]) => {
		const portfolioService = {
			getUserPortfolios: jest.fn().mockResolvedValue([{ assets }]),
		};
		const marketData = {
			getAssetSnapshot: jest.fn(),
			getManyAssetSnapshots: jest.fn(),
			getDailyCloses: jest.fn().mockResolvedValue(closes(60, 0.01)),
		};
		return {
			service: new PortfolioCorrelationService(
				portfolioService as any,
				marketData as any
			),
			marketData,
		};
	};

	const asset = (symbol: string, value: number, type = 'stock') => ({
		symbol,
		type,
		quantity: 1,
		currentPrice: value,
	});

	// Matriz maior não cabe no card do protótipo aprovado.
	it('usa só as seis maiores posições a valor de mercado', async () => {
		const { service, marketData } = makeService(
			['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((symbol, i) =>
				asset(`${symbol}AAA3`, 1000 - i * 100)
			)
		);

		const result = await service.getCorrelation('u1');

		expect(marketData.getDailyCloses).toHaveBeenCalledTimes(6);
		expect(result.symbols).not.toContain('GAAA3');
	});

	it('passa o tipo do ativo e deixa renda fixa de fora', async () => {
		const { service, marketData } = makeService([
			asset('PETR4', 1000),
			asset('BTC', 900, 'crypto'),
			asset('TESOURO2029', 5000, 'fixed_income'),
		]);

		await service.getCorrelation('u1');

		expect(marketData.getDailyCloses).toHaveBeenCalledWith(
			'BTC',
			'1y',
			'crypto'
		);
		expect(marketData.getDailyCloses).not.toHaveBeenCalledWith(
			'TESOURO2029',
			expect.anything(),
			expect.anything()
		);
	});

	it('devolve matriz vazia sem posição com preço', async () => {
		const { service } = makeService([]);

		const result = await service.getCorrelation('u1');

		expect(result.symbols).toEqual([]);
		expect(result.averageCorrelation).toBeNull();
	});
});
