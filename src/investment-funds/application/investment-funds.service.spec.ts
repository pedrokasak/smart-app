import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { InvestmentFundClass } from '../domain/fund-class';
import {
	CVM_SOURCE_LABEL,
	InvestmentFundsService,
	SEARCH_LIMIT,
} from './investment-funds.service';
import type {
	InvestmentFundStore,
	StoredFundQuote,
} from './ports/investment-funds.ports';

const fundClass: InvestmentFundClass = {
	cnpj: '00017024000153',
	name: 'FUNDO EXEMPLO MULTIMERCADO',
	classification: 'Multimercado',
	status: 'Em Funcionamento Normal',
	condominium: 'Aberto',
	exclusive: false,
	targetAudience: 'Público Geral',
	subclasses: [],
};

const stored: StoredFundQuote = {
	cnpj: '00017024000153',
	subclassId: null,
	date: '2026-09-30',
	quota: 44.7,
	netAssetValue: 1_200_000,
	investorCount: 1,
	sourceUrl: 'https://dados.cvm.gov.br/x.zip',
};

function setup(quotes: StoredFundQuote[] = [stored]) {
	const store = {
		searchClasses: jest.fn(async () => [fundClass]),
		findClass: jest.fn(async (cnpj: string) =>
			cnpj === fundClass.cnpj ? fundClass : null
		),
		findClassQuotes: jest.fn(async (cnpjs: string[]) =>
			quotes.filter((quote) => cnpjs.includes(quote.cnpj))
		),
	} as unknown as jest.Mocked<InvestmentFundStore>;
	return { service: new InvestmentFundsService(store), store };
}

describe('InvestmentFundsService', () => {
	it('searches the catalog and attaches the latest quote with its date', async () => {
		const { service, store } = setup();

		const [fund] = await service.search('  exemplo ');

		expect(store.searchClasses).toHaveBeenCalledWith('exemplo', SEARCH_LIMIT);
		expect(fund).toMatchObject({
			cnpj: '00017024000153',
			cnpjFormatted: '00.017.024/0001-53',
			latestQuote: {
				date: '2026-09-30',
				quota: 44.7,
				source: CVM_SOURCE_LABEL,
			},
		});
	});

	it('returns null quote for a class the CVM has not reported yet', async () => {
		const { service } = setup([]);

		await expect(service.getFund('00017024000153')).resolves.toMatchObject({
			latestQuote: null,
		});
	});

	it('rejects an invalid CNPJ and a class outside the catalog', async () => {
		const { service } = setup();

		await expect(service.getFund('123')).rejects.toBeInstanceOf(
			BadRequestException
		);
		await expect(service.getFund('11.222.333/0001-81')).rejects.toBeInstanceOf(
			NotFoundException
		);
	});

	it('resolves a new position to the 14 digits and the official name', async () => {
		const { service } = setup();

		await expect(
			service.resolveForNewPosition('00.017.024/0001-53')
		).resolves.toEqual({
			symbol: '00017024000153',
			name: 'FUNDO EXEMPLO MULTIMERCADO',
		});
	});

	it('gives market quotes only for positive quotas, at midnight in Brasília', async () => {
		const { service, store } = setup([
			stored,
			{ ...stored, cnpj: '11222333000181', quota: -0.97 },
		]);

		const quotes = await service.marketQuotes([
			'00017024000153',
			'11222333000181',
			'PETR4',
		]);

		expect(store.findClassQuotes).toHaveBeenCalledWith([
			'00017024000153',
			'11222333000181',
		]);
		expect(quotes).toEqual([
			{
				symbol: '00017024000153',
				lastQuoteAt: new Date('2026-09-30T03:00:00Z'),
				lastPrice: 44.7,
				source: CVM_SOURCE_LABEL,
			},
		]);
	});
});
