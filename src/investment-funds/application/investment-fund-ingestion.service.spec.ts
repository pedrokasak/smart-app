import type { InvestmentFundClass } from '../domain/fund-class';
import type { FundQuote } from '../domain/fund-quote';
import {
	InvestmentFundIngestionService,
	competencesToRead,
} from './investment-fund-ingestion.service';
import type {
	DailyReport,
	FundHoldingPriceWriter,
	IngestionRecord,
	InvestmentFundDataSource,
	InvestmentFundStore,
	SourceRead,
} from './ports/investment-funds.ports';

const quote: FundQuote = {
	cnpj: '00017024000153',
	subclassId: null,
	date: '2026-09-30',
	quota: 44.7,
	netAssetValue: 1_200_000,
	investorCount: 1,
};

const fundClass: InvestmentFundClass = {
	cnpj: '00017024000153',
	name: 'FUNDO EXEMPLO',
	classification: 'Multimercado',
	status: 'Em Funcionamento Normal',
	condominium: 'Aberto',
	exclusive: false,
	targetAudience: 'Público Geral',
	subclasses: [],
};

function daily(sha: string): SourceRead<DailyReport> {
	return {
		status: 'parsed',
		sourceUrl: 'https://dados.cvm.gov.br/x.zip',
		sha256: sha,
		data: { quotes: [quote], rows: 10, invalidRows: 0, latestDate: quote.date },
	};
}

function setup() {
	const ingestions = new Map<string, IngestionRecord>();
	const source: jest.Mocked<InvestmentFundDataSource> = {
		fetchDailyReport: jest.fn(async (_competence: string, _sha?: string) =>
			daily('sha-1')
		),
		fetchRegistry: jest.fn(async (_sha?: string) => ({
			status: 'parsed' as const,
			sourceUrl: 'https://dados.cvm.gov.br/r.zip',
			sha256: 'reg-1',
			data: [fundClass],
		})),
	};
	const store = {
		replaceClasses: jest.fn(async (list: InvestmentFundClass[]) => list.length),
		upsertLatestQuotes: jest.fn(
			async (list: FundQuote[], _sourceUrl: string) => list.length
		),
		findClass: jest.fn(),
		searchClasses: jest.fn(),
		findClassQuotes: jest.fn(async (_cnpjs: string[]) => [
			{ ...quote, sourceUrl: 'https://dados.cvm.gov.br/x.zip' },
		]),
		countClasses: jest.fn(async () => 0),
		findIngestion: jest.fn(async (key: string) => ingestions.get(key) ?? null),
		saveIngestion: jest.fn(async (record: IngestionRecord) => {
			ingestions.set(record.key, record);
		}),
	} satisfies InvestmentFundStore;
	const holdings = {
		heldCnpjs: jest.fn(async () => ['00017024000153']),
		applyQuotes: jest.fn(async (_quotes: unknown[]) => 1),
	} satisfies FundHoldingPriceWriter;
	const service = new InvestmentFundIngestionService(source, store, holdings);
	return { service, source, store, holdings, ingestions };
}

// 15/10/2026 10h em Brasília.
const MID_MONTH = new Date('2026-10-15T13:00:00Z');

describe('competencesToRead', () => {
	it('reads only the current month after day 10', () => {
		expect(competencesToRead(MID_MONTH)).toEqual(['202610']);
	});

	it('also reads the previous month in the first days', () => {
		expect(competencesToRead(new Date('2026-10-03T13:00:00Z'))).toEqual([
			'202609',
			'202610',
		]);
	});

	it('crosses the year in January', () => {
		expect(competencesToRead(new Date('2027-01-02T13:00:00Z'))).toEqual([
			'202612',
			'202701',
		]);
	});

	it('uses the São Paulo calendar, not UTC', () => {
		// 01/11 01h UTC ainda é 31/10 em Brasília.
		expect(competencesToRead(new Date('2026-11-01T01:00:00Z'))).toEqual([
			'202610',
		]);
	});
});

describe('InvestmentFundIngestionService', () => {
	it('stores the quotes, records provenance and syncs held positions', async () => {
		const { service, store, holdings, ingestions } = setup();

		const results = await service.refreshQuotes(MID_MONTH);

		expect(results).toEqual([
			{
				competence: '202610',
				status: 'parsed',
				rows: 10,
				invalidRows: 0,
				latestDate: '2026-09-30',
				stored: 1,
			},
		]);
		expect(store.upsertLatestQuotes).toHaveBeenCalledWith(
			[quote],
			'https://dados.cvm.gov.br/x.zip'
		);
		expect(ingestions.get('daily:202610')).toMatchObject({
			sha256: 'sha-1',
			rows: 10,
			latestDate: '2026-09-30',
		});
		expect(store.findClassQuotes).toHaveBeenCalledWith(['00017024000153']);
		expect(holdings.applyQuotes).toHaveBeenCalled();
	});

	it('passes the last hash so an unchanged file is not processed', async () => {
		const { service, source, store, holdings } = setup();
		await service.refreshQuotes(MID_MONTH);
		source.fetchDailyReport.mockResolvedValueOnce({
			status: 'unchanged',
			sourceUrl: 'https://dados.cvm.gov.br/x.zip',
			sha256: 'sha-1',
		});
		store.upsertLatestQuotes.mockClear();
		holdings.applyQuotes.mockClear();

		const results = await service.refreshQuotes(MID_MONTH);

		expect(source.fetchDailyReport).toHaveBeenLastCalledWith('202610', 'sha-1');
		expect(results).toEqual([{ competence: '202610', status: 'unchanged' }]);
		expect(store.upsertLatestQuotes).not.toHaveBeenCalled();
		expect(holdings.applyQuotes).not.toHaveBeenCalled();
	});

	it('reports a missing month and keeps going', async () => {
		const { service, source } = setup();
		source.fetchDailyReport
			.mockResolvedValueOnce(daily('sha-9'))
			.mockResolvedValueOnce({
				status: 'missing',
				sourceUrl: 'https://dados.cvm.gov.br/y.zip',
			});

		const results = await service.refreshQuotes(
			new Date('2026-10-02T13:00:00Z')
		);

		expect(results.map((r) => [r.competence, r.status])).toEqual([
			['202609', 'parsed'],
			['202610', 'missing'],
		]);
	});

	it('does not touch positions when nobody holds a fund', async () => {
		const { service, holdings, store } = setup();
		holdings.heldCnpjs.mockResolvedValue([]);

		await service.refreshQuotes(MID_MONTH);

		expect(store.findClassQuotes).not.toHaveBeenCalled();
		expect(holdings.applyQuotes).not.toHaveBeenCalled();
	});

	it('keeps the stored quotes when syncing positions fails', async () => {
		const { service, holdings, store } = setup();
		holdings.applyQuotes.mockRejectedValue(new Error('mongo fora'));

		await expect(service.refreshQuotes(MID_MONTH)).resolves.toHaveLength(1);
		expect(store.upsertLatestQuotes).toHaveBeenCalled();
	});

	it('shares one run between concurrent calls', async () => {
		const { service, source } = setup();

		await Promise.all([
			service.refreshQuotes(MID_MONTH),
			service.refreshQuotes(MID_MONTH),
		]);

		expect(source.fetchDailyReport).toHaveBeenCalledTimes(1);
	});

	it('replaces the registry and records its hash', async () => {
		const { service, store, ingestions } = setup();

		await expect(service.refreshRegistry()).resolves.toBe(1);
		expect(store.replaceClasses).toHaveBeenCalledWith([fundClass]);
		expect(ingestions.get('registry')?.sha256).toBe('reg-1');
	});

	it('refuses a registry with no FIF class instead of wiping the catalog', async () => {
		const { service, source, store } = setup();
		source.fetchRegistry.mockResolvedValue({
			status: 'parsed',
			sourceUrl: 'https://dados.cvm.gov.br/r.zip',
			sha256: 'reg-2',
			data: [],
		});

		await expect(service.refreshRegistry()).rejects.toThrow('nenhuma classe');
		expect(store.replaceClasses).not.toHaveBeenCalled();
	});

	it('returns null for an unchanged registry', async () => {
		const { service, source, store } = setup();
		source.fetchRegistry.mockResolvedValue({
			status: 'unchanged',
			sourceUrl: 'https://dados.cvm.gov.br/r.zip',
			sha256: 'reg-1',
		});

		await expect(service.refreshRegistry()).resolves.toBeNull();
		expect(store.replaceClasses).not.toHaveBeenCalled();
	});
});
