import type { Model } from 'mongoose';
import type { InvestmentFundClass } from '../domain/fund-class';
import type { FundQuote } from '../domain/fund-quote';
import type {
	InvestmentFundClassDocument,
	InvestmentFundIngestionDocument,
	InvestmentFundQuoteDocument,
} from './investment-fund.models';
import { MongoInvestmentFundStore } from './mongo-investment-fund.store';

const exec = <T>(value: T) => ({ exec: jest.fn(async () => value) });

function setup(storedQuotes: Array<{ _id: string; date: string }> = []) {
	const classes = {
		bulkWrite: jest.fn(async () => ({})),
		deleteMany: jest.fn(() => exec({ deletedCount: 0 })),
		find: jest.fn(() => ({
			sort: () => ({ limit: () => ({ lean: () => exec([]) }) }),
		})),
	};
	const quotes = {
		find: jest.fn(() => ({ lean: () => exec(storedQuotes) })),
		bulkWrite: jest.fn(async () => ({})),
	};
	const store = new MongoInvestmentFundStore(
		classes as unknown as Model<InvestmentFundClassDocument>,
		quotes as unknown as Model<InvestmentFundQuoteDocument>,
		{} as Model<InvestmentFundIngestionDocument>
	);
	return { store, classes, quotes };
}

const quote = (cnpj: string, date: string, subclassId: string | null = null) =>
	({
		cnpj,
		subclassId,
		date,
		quota: 10,
		netAssetValue: 100,
		investorCount: 1,
	}) satisfies FundQuote;

describe('MongoInvestmentFundStore', () => {
	it('writes same-or-newer quotes and drops older ones', async () => {
		const { store, quotes } = setup([
			{ _id: '00017024000153', date: '2026-09-30' },
			{ _id: '11222333000181', date: '2026-09-29' },
		]);

		const written = await store.upsertLatestQuotes(
			[
				quote('00017024000153', '2026-08-29'), // reapresentação antiga
				quote('11222333000181', '2026-09-30'),
				quote('11222333000181', '2026-09-30', 'SUB1'),
			],
			'https://dados.cvm.gov.br/x.zip'
		);

		expect(written).toBe(2);
		const operations = (quotes.bulkWrite.mock.calls[0] as any[])[0];
		expect(operations.map((op: any) => op.replaceOne.filter._id)).toEqual([
			'11222333000181',
			'11222333000181:SUB1',
		]);
		expect(operations[0].replaceOne.replacement).toMatchObject({
			cnpj: '11222333000181',
			date: '2026-09-30',
			sourceUrl: 'https://dados.cvm.gov.br/x.zip',
		});
	});

	it('removes classes that left the file only after writing the current ones', async () => {
		const { store, classes } = setup();
		const fundClass: InvestmentFundClass = {
			cnpj: '00017024000153',
			name: 'Fundo Ações Exemplo',
			classification: 'Ações',
			status: 'Em Funcionamento Normal',
			condominium: 'Aberto',
			exclusive: false,
			targetAudience: null,
			subclasses: [],
		};

		await store.replaceClasses([fundClass]);

		const [operations] = classes.bulkWrite.mock.calls[0] as any[];
		expect(operations[0].replaceOne.replacement).toMatchObject({
			_id: '00017024000153',
			searchName: 'fundo acoes exemplo',
		});
		const syncedAt = operations[0].replaceOne.replacement.syncedAt;
		expect(classes.deleteMany).toHaveBeenCalledWith({
			syncedAt: { $lt: syncedAt },
		});
		expect(classes.bulkWrite.mock.invocationCallOrder[0]).toBeLessThan(
			classes.deleteMany.mock.invocationCallOrder[0]
		);
	});

	it('searches by CNPJ prefix when the query is a CNPJ', async () => {
		const { store, classes } = setup();

		await store.searchClasses('00.017.024/0001', 20);

		expect(classes.find).toHaveBeenCalledWith({
			_id: { $regex: '^000170240001' },
		});
	});

	it('searches every word of the name, ignoring accents and regex syntax', async () => {
		const { store, classes } = setup();

		await store.searchClasses('Ações (FIC) .*', 20);

		expect(classes.find).toHaveBeenCalledWith({
			$and: [
				{ searchName: { $regex: 'acoes' } },
				{ searchName: { $regex: '\\(fic\\)' } },
				{ searchName: { $regex: '\\.\\*' } },
			],
		});
	});

	it('returns nothing for a query with no usable term', async () => {
		const { store, classes } = setup();

		await expect(store.searchClasses('a', 20)).resolves.toEqual([]);
		expect(classes.find).not.toHaveBeenCalled();
	});
});
