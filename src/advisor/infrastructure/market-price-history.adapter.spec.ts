import { Logger } from '@nestjs/common';
import type { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';
import { AssetClass } from '../domain/enums';
import {
	MarketPriceHistoryAdapter,
	selectProviderRange,
} from './market-price-history.adapter';

describe('selectProviderRange', () => {
	const today = '2026-11-15';

	it.each([
		['2026-11-01', '1mo'],
		['2026-09-01', '3mo'],
		['2026-06-01', '6mo'],
		['2026-01-01', '1y'],
		['2025-06-01', '2y'],
		['2023-01-01', '5y'],
		['2018-01-01', '10y'],
		['1990-01-01', '10y'],
	])('from %s -> %s', (from, expected) => {
		expect(selectProviderRange(from, today)).toBe(expected);
	});
});

describe('MarketPriceHistoryAdapter', () => {
	let getDailyCloses: jest.Mock;
	let adapter: MarketPriceHistoryAdapter;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		getDailyCloses = jest.fn();
		adapter = new MarketPriceHistoryAdapter({
			getDailyCloses,
		} as unknown as MarketDataProviderPort);
	});

	afterEach(() => jest.restoreAllMocks());

	it('converts close to minor units and filters to [from, to]', async () => {
		getDailyCloses.mockResolvedValue([
			{ date: '2026-01-01', close: 9 },
			{ date: '2026-02-02', close: 12.34 },
			{ date: '2026-03-03', close: 20 },
		]);
		const result = await adapter.getDailyCloses(
			'PETR4',
			AssetClass.Stock,
			'2026-02-01',
			'2026-02-28'
		);
		expect(result).toEqual([{ date: '2026-02-02', closeMinor: 1234 }]);
		expect(getDailyCloses).toHaveBeenCalledWith(
			'PETR4',
			expect.any(String),
			'stock'
		);
	});

	it('drops zero, negative and NaN closes', async () => {
		getDailyCloses.mockResolvedValue([
			{ date: '2026-02-01', close: 0 },
			{ date: '2026-02-02', close: -3 },
			{ date: '2026-02-03', close: Number.NaN },
			{ date: '2026-02-04', close: 5 },
		]);
		const result = await adapter.getDailyCloses(
			'X',
			AssetClass.Fii,
			'2026-02-01',
			'2026-02-28'
		);
		expect(result).toEqual([{ date: '2026-02-04', closeMinor: 500 }]);
	});

	it.each([AssetClass.FixedIncome, AssetClass.Other])(
		'%s does not call the provider',
		async (assetClass) => {
			const result = await adapter.getDailyCloses(
				'X',
				assetClass,
				'2026-02-01',
				'2026-02-28'
			);
			expect(result).toEqual([]);
			expect(getDailyCloses).not.toHaveBeenCalled();
		}
	);

	it('returns [] and warns with only the ticker when the provider throws', async () => {
		getDailyCloses.mockRejectedValue(new Error('boom'));
		const result = await adapter.getDailyCloses(
			'PETR4',
			AssetClass.Stock,
			'2026-02-01',
			'2026-02-28'
		);
		expect(result).toEqual([]);
		expect(Logger.prototype.warn).toHaveBeenCalledWith(
			expect.stringContaining('PETR4')
		);
	});
});
