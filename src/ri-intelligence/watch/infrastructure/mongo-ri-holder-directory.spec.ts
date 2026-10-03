import { Model, Types } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import {
	issuerBaseCode,
	MongoRiHolderDirectory,
} from 'src/ri-intelligence/watch/infrastructure/mongo-ri-holder-directory';

function chain<T>(result: T) {
	const query = {
		select: jest.fn(() => query),
		lean: jest.fn().mockResolvedValue(result),
	};
	return query;
}

describe('MongoRiHolderDirectory (TRA-261)', () => {
	const portfolioA = new Types.ObjectId();
	const portfolioB = new Types.ObjectId();
	const portfolioC = new Types.ObjectId();
	const userX = new Types.ObjectId();
	const userY = new Types.ObjectId();

	let assetModel: { find: jest.Mock };
	let portfolioModel: { find: jest.Mock };
	let directory: MongoRiHolderDirectory;

	beforeEach(() => {
		assetModel = { find: jest.fn(() => chain([])) };
		portfolioModel = { find: jest.fn(() => chain([])) };
		directory = new MongoRiHolderDirectory(
			assetModel as unknown as Model<Asset>,
			portfolioModel as unknown as Model<Portfolio>
		);
	});

	it.each([
		['PETR4', 'PETR'],
		['TAEE11', 'TAEE'],
		['B3SA3', 'B3SA'],
		['petr4.sa', 'PETR'],
		['PETR', null],
		['PETR4F', null],
		['', null],
	])('issuer of %p is %p', (ticker, base) => {
		expect(issuerBaseCode(ticker)).toBe(base);
	});

	it('looks up every class of the issuer, only open stock and FII positions', async () => {
		await directory.holdersOfIssuer('PETR3');

		expect(assetModel.find).toHaveBeenCalledWith({
			symbol: { $regex: '^PETR\\d{1,2}(\\.SA)?$' },
			quantity: { $gt: 0 },
			// TRA-266: quem tem FII tambem recebe o aviso.
			type: { $in: ['stock', 'fii'] },
		});
		const regex = new RegExp(assetModel.find.mock.calls[0][0].symbol.$regex);
		expect(['PETR3', 'PETR4', 'PETR4.SA'].every((s) => regex.test(s))).toBe(
			true
		);
		expect(['PETRX3', 'PETR', 'PRIO3'].some((s) => regex.test(s))).toBe(false);
	});

	it('returns one holder per user, with the class that user holds', async () => {
		assetModel.find.mockReturnValue(
			chain([
				{ portfolioId: portfolioA, symbol: 'PETR4' },
				{ portfolioId: portfolioB, symbol: 'PETR3' },
				// Mesmo usuario, segunda carteira, outra classe: um aviso so.
				{ portfolioId: portfolioC, symbol: 'PETR4.SA' },
			])
		);
		portfolioModel.find.mockReturnValue(
			chain([
				{ _id: portfolioA, userId: userX },
				{ _id: portfolioB, userId: userY },
				{ _id: portfolioC, userId: userY },
			])
		);

		const result = await directory.holdersOfIssuer('PETR4');

		expect(result).toEqual(
			[
				{ userId: String(userX), ticker: 'PETR4' },
				{ userId: String(userY), ticker: 'PETR3' },
			].sort((a, b) => a.userId.localeCompare(b.userId))
		);
	});

	it('ignores positions whose portfolio has no owner', async () => {
		assetModel.find.mockReturnValue(
			chain([{ portfolioId: portfolioA, symbol: 'PETR4' }])
		);

		await expect(directory.holdersOfIssuer('PETR4')).resolves.toEqual([]);
	});

	it('does not query for a ticker without an issuer code', async () => {
		await expect(directory.holdersOfIssuer('???')).resolves.toEqual([]);
		expect(assetModel.find).not.toHaveBeenCalled();
	});
});
