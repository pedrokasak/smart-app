import { TrackerrMarketDataFacade } from './trackerr-market-data.facade';

/**
 * Histórico diário (TRA-251): a série guardada do COTAHIST vem antes do
 * Yahoo, que responde 429 a partir da VPS.
 */
describe('TrackerrMarketDataFacade.getDailyCloses com série guardada (TRA-251)', () => {
	const todayIso = new Date().toISOString().slice(0, 10);
	const daysAgo = (days: number) => {
		const date = new Date();
		date.setUTCDate(date.getUTCDate() - days);
		return date.toISOString().slice(0, 10);
	};
	/** Série que começa no início do intervalo e chega a hoje. */
	const fullYear = [
		{ date: daysAgo(364), close: 10 },
		{ date: daysAgo(2), close: 12 },
		{ date: todayIso, close: 13 },
	];
	const yahoo = [{ date: daysAgo(300), close: 99 }];

	function build(stored: unknown, yahooResult: unknown = yahoo) {
		const stockService = {
			getDailyCloses:
				yahooResult instanceof Error
					? jest.fn().mockRejectedValue(yahooResult)
					: jest.fn().mockResolvedValue(yahooResult),
		};
		const store = {
			find:
				stored instanceof Error
					? jest.fn().mockRejectedValue(stored)
					: jest.fn().mockResolvedValue(stored),
		};
		const facade = new TrackerrMarketDataFacade(
			stockService as any,
			{} as any,
			undefined,
			store as any
		);
		return { facade, stockService, store };
	}

	it('série guardada que cobre o período responde sem tocar no Yahoo', async () => {
		const { facade, stockService } = build(fullYear);

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(
			fullYear
		);
		expect(stockService.getDailyCloses).not.toHaveBeenCalled();
	});

	it('série que não cobre o período cai no Yahoo', async () => {
		const short = [
			{ date: daysAgo(30), close: 10 },
			{ date: todayIso, close: 11 },
		];
		const { facade, stockService } = build(short);

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(yahoo);
		expect(stockService.getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			'1y',
			'stock'
		);
	});

	it('Yahoo em 429 (vazio): a série parcial guardada vale mais que nada', async () => {
		const short = [
			{ date: daysAgo(30), close: 10 },
			{ date: todayIso, close: 11 },
		];
		const { facade } = build(short, []);

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(short);
	});

	it('Yahoo lançando erro também cai na série parcial', async () => {
		const short = [{ date: daysAgo(30), close: 10 }];
		const { facade } = build(short, new Error('429'));

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(short);
	});

	it('sem nada guardado, o comportamento é o de antes (Yahoo)', async () => {
		const { facade } = build([]);

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(yahoo);
	});

	it('falha ao ler a série guardada não derruba: segue para o Yahoo', async () => {
		const { facade } = build(new Error('mongo fora'));

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(yahoo);
	});

	it.each([
		['índice', '^BVSP', 'stock'],
		['cripto', 'BTC', 'crypto'],
	])('%s não usa a série guardada', async (_label, symbol, type) => {
		const { facade, store } = build(fullYear);

		await facade.getDailyCloses(symbol, '1y', type as any);

		expect(store.find).not.toHaveBeenCalled();
	});

	it('FII e ETF usam a série guardada', async () => {
		const { facade, store } = build(fullYear);

		await facade.getDailyCloses('HGLG11', '1y', 'fii');
		await facade.getDailyCloses('BOVA11', '1y', 'etf');

		expect(store.find).toHaveBeenCalledTimes(2);
	});

	it('intervalo "max" nunca é provado completo: pergunta ao Yahoo', async () => {
		const { facade, stockService } = build(fullYear);

		await facade.getDailyCloses('PETR4', 'max', 'stock');

		expect(stockService.getDailyCloses).toHaveBeenCalled();
	});

	it('sem o store injetado (fora do módulo) segue só com o Yahoo', async () => {
		const stockService = { getDailyCloses: jest.fn().mockResolvedValue(yahoo) };
		const facade = new TrackerrMarketDataFacade(stockService as any, {} as any);

		expect(await facade.getDailyCloses('PETR4', '1y', 'stock')).toEqual(yahoo);
	});
});
