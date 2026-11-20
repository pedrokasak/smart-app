import { Types } from 'mongoose';
import { PortfolioSharingReadService } from './portfolio-sharing-read.service';

const WRITE_METHODS = [
	'create',
	'updateOne',
	'updateMany',
	'deleteOne',
	'deleteMany',
	'save',
	'findOneAndUpdate',
];

type Filter = Record<string, any>;

function fakeModel(rows: any[]) {
	const query: Record<string, jest.Mock> = {};
	const exec = jest.fn().mockResolvedValue(rows);
	const sort = jest.fn().mockReturnValue(query);
	const select = jest.fn().mockReturnValue(query);
	Object.assign(query, {
		sort,
		select,
		lean: jest.fn().mockReturnValue(query),
		exec,
	});
	const find = jest.fn().mockReturnValue(query);
	const model: Record<string, jest.Mock> = { find };
	for (const m of WRITE_METHODS) model[m] = jest.fn();
	return { model, find, sort, select };
}

const oid = () => new Types.ObjectId();

describe('PortfolioSharingReadService', () => {
	const userId = oid();
	const portfolioId = oid();
	const otherPortfolioId = oid();

	function build(portfolios: any[], assets: any[] = [], trades: any[] = []) {
		const p = fakeModel(portfolios);
		const a = fakeModel(assets);
		const t = fakeModel(trades);
		const service = new PortfolioSharingReadService(
			p.model as any,
			a.model as any,
			t.model as any
		);
		return { service, p, a, t };
	}

	it('listOwned queries by userId and returns id and name', async () => {
		const { service, p } = build([{ _id: portfolioId, name: 'Main' }]);

		const out = await service.listOwned(userId.toString());

		expect(p.find).toHaveBeenCalledTimes(1);
		const filter: Filter = p.find.mock.calls[0][0];
		expect(String(filter.userId)).toBe(userId.toString());
		expect(p.sort).toHaveBeenCalledWith({ createdAt: 1 });
		expect(out).toEqual([{ id: portfolioId.toString(), name: 'Main' }]);
	});

	it('readOwned filters portfolios by ids and userId', async () => {
		const { service, p } = build([{ _id: portfolioId, userId, name: 'Mine' }]);

		const out = await service.readOwned(userId.toString(), [
			portfolioId.toString(),
			otherPortfolioId.toString(),
		]);

		const filter: Filter = p.find.mock.calls[0][0];
		expect(String(filter.userId)).toBe(userId.toString());
		expect(filter._id.$in.map(String)).toEqual([
			portfolioId.toString(),
			otherPortfolioId.toString(),
		]);
		expect(out.map((x) => x.id)).toEqual([portfolioId.toString()]);
	});

	it('ignores malformed ids without throwing', async () => {
		const { service, p } = build([{ _id: portfolioId, name: 'Mine' }]);

		const out = await service.readOwned(userId.toString(), [
			'not-an-id',
			portfolioId.toString(),
		]);

		const filter: Filter = p.find.mock.calls[0][0];
		expect(filter._id.$in.map(String)).toEqual([portfolioId.toString()]);
		expect(out).toHaveLength(1);
	});

	it('returns nothing and queries nothing when no id is valid', async () => {
		const { service, p, a, t } = build([]);

		expect(await service.readOwned(userId.toString(), ['x'])).toEqual([]);
		expect(
			await service.readOwned('bad-user', [portfolioId.toString()])
		).toEqual([]);
		expect(p.find).not.toHaveBeenCalled();
		expect(a.find).not.toHaveBeenCalled();
		expect(t.find).not.toHaveBeenCalled();
	});

	it('drops zero-quantity assets and picks unitCost from avgPrice or price', async () => {
		const { service, a } = build(
			[{ _id: portfolioId, name: 'Mine' }],
			[
				{
					symbol: 'AAA',
					type: 'stock',
					quantity: 10,
					price: 5,
					avgPrice: 7,
					source: 'b3',
				},
				{
					symbol: 'BBB',
					type: 'fii',
					quantity: 2,
					price: 9,
					source: 'manual',
				},
				{
					symbol: 'CCC',
					type: 'stock',
					quantity: 3,
					price: 4,
					avgPrice: 0,
					source: 'webscrape',
				},
			]
		);

		const [dto] = await service.readOwned(userId.toString(), [
			portfolioId.toString(),
		]);

		const filter: Filter = a.find.mock.calls[0][0];
		expect(filter.quantity).toEqual({ $gt: 0 });
		expect(a.sort).toHaveBeenCalledWith({ symbol: 1 });
		expect(dto.holdings).toEqual([
			{ symbol: 'AAA', type: 'stock', quantity: 10, unitCost: 7, source: 'b3' },
			{
				symbol: 'BBB',
				type: 'fii',
				quantity: 2,
				unitCost: 9,
				source: 'manual',
			},
			{
				symbol: 'CCC',
				type: 'stock',
				quantity: 3,
				unitCost: 4,
				source: 'webscrape',
			},
		]);
	});

	it('queries trades by owner and portfolio, mapping imported and date', async () => {
		const createdAt = new Date('2026-02-01T10:00:00Z');
		const { service, t } = build(
			[{ _id: portfolioId, name: 'Mine' }],
			[],
			[
				{
					symbol: 'AAA',
					side: 'buy',
					quantity: 1,
					price: 10,
					fees: 0.5,
					date: new Date('2026-01-31T23:59:59Z'),
					uploadId: oid(),
					createdAt,
				},
				{
					symbol: 'BBB',
					side: 'sell',
					quantity: 2,
					price: 11,
					date: new Date('2026-01-02T00:00:00Z'),
					createdAt,
				},
			]
		);

		const [dto] = await service.readOwned(userId.toString(), [
			portfolioId.toString(),
		]);

		const filter: Filter = t.find.mock.calls[0][0];
		expect(String(filter.userId)).toBe(userId.toString());
		expect(String(filter.portfolioId)).toBe(portfolioId.toString());
		expect(t.sort).toHaveBeenCalledWith({ date: 1, createdAt: 1 });
		expect(dto.trades).toEqual([
			{
				symbol: 'AAA',
				side: 'buy',
				quantity: 1,
				price: 10,
				fees: 0.5,
				date: '2026-01-31',
				imported: true,
				createdAt,
			},
			{
				symbol: 'BBB',
				side: 'sell',
				quantity: 2,
				price: 11,
				fees: 0,
				date: '2026-01-02',
				imported: false,
				createdAt,
			},
		]);
	});

	it('skips a trade with an invalid date instead of failing the whole read', async () => {
		const createdAt = new Date('2026-02-01T10:00:00Z');
		const { service } = build(
			[{ _id: portfolioId, name: 'Mine' }],
			[],
			[
				{
					symbol: 'BAD',
					side: 'buy',
					quantity: 1,
					price: 10,
					date: 'not-a-date',
					createdAt,
				},
				{ symbol: 'NODATE', side: 'buy', quantity: 1, price: 10, createdAt },
				{
					symbol: 'AAA',
					side: 'buy',
					quantity: 1,
					price: 10,
					date: new Date('2026-01-02T00:00:00Z'),
					createdAt,
				},
			]
		);

		const [dto] = await service.readOwned(userId.toString(), [
			portfolioId.toString(),
		]);

		expect(dto.trades.map((t) => t.symbol)).toEqual(['AAA']);
	});

	it('projects only the fields the DTOs need from every model', async () => {
		const { service, p, a, t } = build([{ _id: portfolioId, name: 'Mine' }]);

		await service.listOwned(userId.toString());
		await service.readOwned(userId.toString(), [portfolioId.toString()]);

		const portfolioProjection = { _id: 1, name: 1 };
		expect(p.select.mock.calls).toEqual([
			[portfolioProjection],
			[portfolioProjection],
		]);
		expect(a.select).toHaveBeenCalledWith({
			symbol: 1,
			type: 1,
			quantity: 1,
			price: 1,
			avgPrice: 1,
			source: 1,
		});
		expect(t.select).toHaveBeenCalledWith({
			symbol: 1,
			side: 1,
			quantity: 1,
			price: 1,
			fees: 1,
			date: 1,
			uploadId: 1,
			createdAt: 1,
		});
	});

	it('exposes only the DTO keys', async () => {
		const { service } = build(
			[
				{
					_id: portfolioId,
					name: 'Mine',
					cpf: '123',
					ownerName: 'Joe',
					description: 'd',
				},
			],
			[
				{
					symbol: 'AAA',
					type: 'stock',
					quantity: 1,
					price: 1,
					source: 'b3',
					indicators: { roe: 1 },
					dividendHistory: [{ value: 1 }],
				},
			]
		);

		const [dto] = await service.readOwned(userId.toString(), [
			portfolioId.toString(),
		]);

		expect(Object.keys(dto).sort()).toEqual([
			'holdings',
			'id',
			'name',
			'trades',
		]);
		expect(Object.keys(dto.holdings[0]).sort()).toEqual([
			'quantity',
			'source',
			'symbol',
			'type',
			'unitCost',
		]);
		for (const key of [
			'cpf',
			'ownerName',
			'description',
			'indicators',
			'dividendHistory',
		]) {
			expect(dto).not.toHaveProperty(key);
			expect(dto.holdings[0]).not.toHaveProperty(key);
		}
	});

	it('never calls a write method on any model', async () => {
		const { service, p, a, t } = build([{ _id: portfolioId, name: 'Mine' }]);

		await service.listOwned(userId.toString());
		await service.readOwned(userId.toString(), [portfolioId.toString()]);

		for (const m of [p, a, t]) {
			for (const w of WRITE_METHODS) expect(m.model[w]).not.toHaveBeenCalled();
		}
	});
});
