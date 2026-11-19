import { Logger } from '@nestjs/common';
import type { MacroSeriesService } from 'src/macro-indicators/application/macro-series.service';
import type { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';
import { MacroBenchmarkSeriesAdapter } from './macro-benchmark-series.adapter';

describe('MacroBenchmarkSeriesAdapter', () => {
	let getSeries: jest.Mock;
	let getDailyCloses: jest.Mock;
	let adapter: MacroBenchmarkSeriesAdapter;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		getSeries = jest.fn();
		getDailyCloses = jest.fn();
		adapter = new MacroBenchmarkSeriesAdapter(
			{ getSeries } as unknown as MacroSeriesService,
			{ getDailyCloses } as unknown as MarketDataProviderPort
		);
	});

	afterEach(() => jest.restoreAllMocks());

	it('compounds CDI percent-per-day into a fraction', async () => {
		getSeries.mockResolvedValue({
			points: [
				{ date: '2026-02-02', value: 0.05 },
				{ date: '2026-02-03', value: 0.05 },
			],
		});
		const result = await adapter.periodReturn(
			'CDI',
			'2026-02-01',
			'2026-02-28'
		);
		expect(result).toBeCloseTo(0.00100025, 8);
		expect(getSeries).toHaveBeenCalledWith('CDI', '2026-02-01', '2026-02-28');
	});

	it('returns null for an empty CDI series', async () => {
		getSeries.mockResolvedValue({ points: [] });
		expect(
			await adapter.periodReturn('CDI', '2026-02-01', '2026-02-28')
		).toBeNull();
	});

	it('compounds IPCA months whose day 01 falls in the window', async () => {
		getSeries.mockResolvedValue({
			points: [
				{ date: '2026-01-01', value: 9 },
				{ date: '2026-02-01', value: 0.5 },
				{ date: '2026-03-01', value: 0.4 },
				{ date: '2026-04-01', value: 9 },
			],
		});
		const result = await adapter.periodReturn(
			'IPCA',
			'2026-02-01',
			'2026-03-31'
		);
		expect(result).toBeCloseTo(0.00902, 5);
	});

	it('computes IBOV last/first - 1 inside the window', async () => {
		getDailyCloses.mockResolvedValue([
			{ date: '2026-01-02', close: 1 },
			{ date: '2026-02-02', close: 100000 },
			{ date: '2026-02-20', close: 103000 },
			{ date: '2026-03-02', close: 1 },
		]);
		const result = await adapter.periodReturn(
			'IBOV',
			'2026-02-01',
			'2026-02-28'
		);
		expect(result).toBeCloseTo(0.03, 10);
		expect(getDailyCloses).toHaveBeenCalledWith('^BVSP', expect.any(String));
	});

	it('returns null for IBOV with a single point', async () => {
		getDailyCloses.mockResolvedValue([{ date: '2026-02-02', close: 100000 }]);
		expect(
			await adapter.periodReturn('IBOV', '2026-02-01', '2026-02-28')
		).toBeNull();
	});

	it('returns null and warns with the key when a source throws', async () => {
		getDailyCloses.mockRejectedValue(new Error('boom'));
		getSeries.mockRejectedValue(new Error('down'));
		expect(
			await adapter.periodReturn('IBOV', '2026-02-01', '2026-02-28')
		).toBeNull();
		expect(
			await adapter.periodReturn('CDI', '2026-02-01', '2026-02-28')
		).toBeNull();
		expect(Logger.prototype.warn).toHaveBeenCalledWith(
			expect.stringContaining('IBOV')
		);
		expect(Logger.prototype.warn).toHaveBeenCalledWith(
			expect.stringContaining('CDI')
		);
	});
});
