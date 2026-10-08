import { MongoHeldSymbolsReader } from './mongo-held-symbols.reader';

describe('MongoHeldSymbolsReader (TRA-251)', () => {
	function build(
		symbols: string[],
		firstTrades: { _id: string; since: Date }[]
	) {
		const assets = { distinct: jest.fn().mockResolvedValue(symbols) };
		const trades = { aggregate: jest.fn().mockResolvedValue(firstTrades) };
		return {
			reader: new MongoHeldSymbolsReader(assets as any, trades as any),
			assets,
			trades,
		};
	}

	it('só ação, FII e ETF: cripto, fundo e renda fixa têm outra fonte', async () => {
		const { reader, assets } = build([], []);

		await reader.list();

		expect(assets.distinct).toHaveBeenCalledWith('symbol', {
			type: { $in: ['stock', 'fii', 'etf'] },
		});
	});

	it('junta cada símbolo com a negociação mais antiga', async () => {
		const since = new Date('2024-03-04');
		const { reader } = build(['PETR4', 'VALE3'], [{ _id: 'PETR4', since }]);

		expect(await reader.list()).toEqual([
			{ symbol: 'PETR4', since },
			{ symbol: 'VALE3', since: null },
		]);
	});

	it('normaliza para maiúsculas e não repete símbolo', async () => {
		const { reader } = build(['petr4', 'PETR4', ''], []);

		expect(await reader.list()).toEqual([{ symbol: 'PETR4', since: null }]);
	});

	it('casa a negociação com o símbolo mesmo em caixa diferente', async () => {
		const since = new Date('2023-01-02');
		const { reader } = build(['PETR4'], [{ _id: 'petr4', since }]);

		expect((await reader.list())[0].since).toEqual(since);
	});
});
