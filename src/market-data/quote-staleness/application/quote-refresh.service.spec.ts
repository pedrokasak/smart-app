import { Test } from '@nestjs/testing';
import {
	MARKET_DATA_PROVIDER,
	MarketAssetSnapshot,
} from 'src/market-data/application/market-data-provider.port';
import { QuoteFreshnessRecord } from '../domain/quote-freshness';
import { QUOTE_FRESHNESS_STORE } from './ports/quote-freshness.port';
import { QuoteRefreshService } from './quote-refresh.service';

function snapshot(
	symbol: string,
	price: number | null,
	asOf?: string
): MarketAssetSnapshot {
	return {
		symbol,
		assetType: 'stock',
		sector: null,
		price,
		dividendYield: null,
		performance: { changePercent: null },
		fundamentals: {
			priceToEarnings: null,
			priceToBook: null,
			returnOnEquity: null,
			netMargin: null,
			evEbitda: null,
			marketCap: null,
		},
		metadata: {
			source: 'primary',
			fallbackUsed: false,
			partial: false,
			fallbackSources: [],
			...(asOf ? { asOf } : {}),
		},
	};
}

/**
 * A propriedade que sustenta a honestidade do sinal inteiro: o carimbo so
 * e escrito quando a leitura DEU CERTO. E a ausencia de escrita que faz o
 * relogio do simbolo andar — gravar no caminho de erro transformaria a
 * fonte fora do ar em silencio eterno.
 */
describe('QuoteRefreshService (TRA-136, fase 7)', () => {
	const NOW = new Date('2026-03-05T12:00:00.000Z');

	let gravados: QuoteFreshnessRecord[];
	let getMany: jest.Mock;
	let service: QuoteRefreshService;

	beforeEach(async () => {
		gravados = [];
		getMany = jest.fn();

		const moduleRef = await Test.createTestingModule({
			providers: [
				QuoteRefreshService,
				{
					provide: MARKET_DATA_PROVIDER,
					useValue: {
						getManyAssetSnapshots: getMany,
						getAssetSnapshot: jest.fn(),
					},
				},
				{
					provide: QUOTE_FRESHNESS_STORE,
					useValue: {
						recordReads: async (records: QuoteFreshnessRecord[]) => {
							gravados.push(...records);
						},
						findBySymbols: async () => [],
					},
				},
			],
		}).compile();

		service = moduleRef.get(QuoteRefreshService);
	});

	it('carimba apenas os simbolos que voltaram com preco', async () => {
		getMany.mockResolvedValue([
			snapshot('PETR4', 38.2, '2026-03-05T11:59:00.000Z'),
			snapshot('VALE3', null), // fonte respondeu sem preco
		]);

		const result = await service.refresh(['petr4', 'vale3'], NOW);

		expect(result).toEqual({ requested: 2, stamped: 1 });
		expect(gravados).toHaveLength(1);
		expect(gravados[0].symbol).toBe('PETR4');
		expect(gravados[0].lastQuoteAt.toISOString()).toBe(
			'2026-03-05T11:59:00.000Z'
		);
	});

	it('usa o `asOf` da fonte; sem ele, o instante da varredura', async () => {
		getMany.mockResolvedValue([snapshot('ITUB4', 30)]);

		await service.refresh(['ITUB4'], NOW);

		expect(gravados[0].lastQuoteAt.toISOString()).toBe(NOW.toISOString());
	});

	it('provider fora do ar nao grava nada — o relogio segue correndo', async () => {
		getMany.mockRejectedValue(new Error('fonte fora'));

		const result = await service.refresh(['PETR4', 'VALE3'], NOW);

		expect(result).toEqual({ requested: 2, stamped: 0 });
		expect(gravados).toHaveLength(0);
	});

	it('simbolo que a fonte nao devolveu nao e carimbado', async () => {
		getMany.mockResolvedValue([snapshot('PETR4', 38.2)]);

		const result = await service.refresh(['PETR4', 'XPTO9'], NOW);

		expect(result.stamped).toBe(1);
		expect(gravados.map((r) => r.symbol)).toEqual(['PETR4']);
	});

	it('deduplica e normaliza a lista pedida antes de chamar a fonte', async () => {
		getMany.mockResolvedValue([]);

		await service.refresh([' petr4 ', 'PETR4', '', 'vale3'], NOW);

		expect(getMany).toHaveBeenCalledWith(['PETR4', 'VALE3']);
	});

	it('lista vazia nao chama a fonte', async () => {
		const result = await service.refresh([], NOW);

		expect(getMany).not.toHaveBeenCalled();
		expect(result).toEqual({ requested: 0, stamped: 0 });
	});
});
