import type { MacroSeriesService } from 'src/macro-indicators/application/macro-series.service';
import {
	type MacroSeriesKey,
	SERIES_CATALOG,
} from 'src/macro-indicators/domain/series-catalog';
import { FixedIncomeRatesService } from './fixed-income-rates.service';
import type { TesouroOffersService } from './tesouro-offers.service';

const NOW = new Date('2026-10-05T13:00:00.000Z'); // 2026-10-05 em Brasília

type Points = Array<{ date: string; value: number }>;

function macroWith(series: Partial<Record<MacroSeriesKey, Points | Error>>) {
	const getSeries = jest.fn(async (key: MacroSeriesKey) => {
		const value = series[key];
		if (value instanceof Error) throw value;
		return {
			descriptor: SERIES_CATALOG[key],
			points: value ?? [],
			extractedAt: NOW,
			sourceUrl: 'https://api.bcb.gov.br/x',
		};
	});
	return { getSeries } as unknown as MacroSeriesService;
}

const noTesouro = {
	getOffers: async () => null,
} as unknown as TesouroOffersService;

const months = (
	count: number,
	value: number,
	lastMonth = '2026-08'
): Points => {
	const [year, month] = lastMonth.split('-').map(Number);
	return Array.from({ length: count }, (_, index) => {
		const offset = count - 1 - index;
		const total = year * 12 + (month - 1) - offset;
		const y = Math.floor(total / 12);
		const m = (total % 12) + 1;
		return { date: `${y}-${String(m).padStart(2, '0')}-01`, value };
	});
};

const service = (macro: MacroSeriesService, tesouro = noTesouro) =>
	new FixedIncomeRatesService(macro, tesouro, () => NOW);

describe('FixedIncomeRatesService', () => {
	it('CDI: anualiza o CDI diário do BACEN e informa a data e a série', async () => {
		const rates = await service(
			macroWith({
				CDI: [
					{ date: '2026-09-30', value: 0.050788 },
					{ date: '2026-10-01', value: 0.050788 },
				],
			})
		).getRates();

		expect(rates.cdi?.valuePct).toBeCloseTo(13.65, 2);
		expect(rates.cdi?.asOf).toBe('2026-10-01');
		expect(rates.cdi?.source).toBe('BACEN_SGS_12');
		expect(rates.cdi?.stale).toBe(false);
	});

	it('CDI de mais de uma semana atrás sai marcado como desatualizado', async () => {
		const rates = await service(
			macroWith({ CDI: [{ date: '2026-09-20', value: 0.050788 }] })
		).getRates();
		expect(rates.cdi?.stale).toBe(true);
	});

	it('Selic meta: último valor publicado até hoje', async () => {
		const rates = await service(
			macroWith({
				SELIC_META: [
					{ date: '2026-10-02', value: 13.75 },
					{ date: '2026-10-05', value: 13.75 },
				],
			})
		).getRates();
		expect(rates.selicMeta).toMatchObject({
			valuePct: 13.75,
			asOf: '2026-10-05',
			source: 'BACEN_SGS_432',
			stale: false,
		});
	});

	it('IPCA 12 meses: encadeia os 12 últimos meses publicados (não soma)', async () => {
		const rates = await service(
			macroWith({ IPCA: months(14, 0.4) })
		).getRates();
		// (1,004)^12 − 1 = 4,9070% — somar daria 4,80%.
		expect(rates.ipca12m?.valuePct).toBeCloseTo(4.907, 3);
		expect(rates.ipca12m?.asOf).toBe('2026-08-01');
		expect(rates.ipca12m?.source).toBe('BACEN_SGS_433');
		expect(rates.ipca12m?.stale).toBe(false);
	});

	it('IPCA com menos de 12 meses ou com mês faltando não vira número', async () => {
		expect(
			(await service(macroWith({ IPCA: months(11, 0.4) })).getRates()).ipca12m
		).toBeNull();

		const withHole = months(13, 0.4);
		withHole.splice(6, 1); // 12 pontos, mas 13 meses de calendário
		expect(
			(await service(macroWith({ IPCA: withHole })).getRates()).ipca12m
		).toBeNull();
	});

	it('IPCA publicado há mais de 100 dias sai como desatualizado', async () => {
		const rates = await service(
			macroWith({ IPCA: months(12, 0.4, '2026-05') })
		).getRates();
		expect(rates.ipca12m?.stale).toBe(true);
	});

	it('série vazia vira null, sem inventar valor', async () => {
		const rates = await service(
			macroWith({ CDI: [], SELIC_META: [], IPCA: [] })
		).getRates();
		expect(rates.cdi).toBeNull();
		expect(rates.selicMeta).toBeNull();
		expect(rates.ipca12m).toBeNull();
	});

	it('uma fonte que falha não derruba as outras', async () => {
		const rates = await service(
			macroWith({
				CDI: new Error('BACEN fora'),
				SELIC_META: [{ date: '2026-10-05', value: 13.75 }],
				IPCA: months(12, 0.4),
			})
		).getRates();
		expect(rates.cdi).toBeNull();
		expect(rates.selicMeta?.valuePct).toBe(13.75);
		expect(rates.ipca12m).not.toBeNull();
		expect(rates.tesouro).toBeNull();
	});

	it('leituras seguidas reaproveitam o resultado por meio minuto, depois leem de novo', async () => {
		let now = NOW;
		const macro = macroWith({
			CDI: [{ date: '2026-10-01', value: 0.050788 }],
			SELIC_META: [{ date: '2026-10-05', value: 13.75 }],
			IPCA: months(12, 0.4),
		});
		const rates = new FixedIncomeRatesService(macro, noTesouro, () => now);

		const first = await rates.getRates();
		const second = await rates.getRates();
		expect(second).toBe(first);
		expect(macro.getSeries).toHaveBeenCalledTimes(3); // CDI, Selic meta e IPCA, uma vez

		now = new Date(NOW.getTime() + 31_000);
		await rates.getRates();
		expect(macro.getSeries).toHaveBeenCalledTimes(6);
	});

	it('Tesouro: devolve os títulos com pregão, leitura e fonte', async () => {
		const fetchedAt = new Date('2026-10-05T13:40:00.000Z');
		const tesouro = {
			getOffers: async () => ({
				baseDate: '2026-10-02',
				fetchedAt,
				sourceUrl: 'https://www.tesourotransparente.gov.br/x.csv',
				stale: false,
				titles: [
					{
						id: 'SELIC:2031-03-01',
						family: 'SELIC',
						name: 'Tesouro Selic 2031',
						maturityDate: '2031-03-01',
						buyRatePct: 0.09,
						sellRatePct: 0.1,
						unitPrice: 19943.12,
						baseDate: '2026-10-02',
					},
				],
			}),
		} as unknown as TesouroOffersService;

		const rates = await service(macroWith({}), tesouro).getRates();
		expect(rates.tesouro).toMatchObject({
			baseDate: '2026-10-02',
			fetchedAt: fetchedAt.toISOString(),
			stale: false,
		});
		expect(rates.tesouro?.titles).toHaveLength(1);
	});
});
