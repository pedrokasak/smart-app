import {
	AssetClass,
	LiquidityBucket,
	PortfolioProvenance,
	Provenance,
} from './enums';
import { Position } from './portfolio.entities';
import {
	allocationByClass,
	allocationDrift,
	liquidityBreakdown,
	portfolioProvenance,
	topPositions,
	valuePositions,
} from './snapshot-metrics';

const pos = (over: Partial<Position> = {}): Position => ({
	symbol: 'A',
	assetClass: AssetClass.Stock,
	quantity: 1,
	costMinor: 0,
	provenance: Provenance.Verified,
	...over,
});

describe('snapshot-metrics', () => {
	it('weights and concentration: values 50/30/20', () => {
		const valued = valuePositions(
			[
				pos({ symbol: 'A', quantity: 10 }),
				pos({ symbol: 'B', quantity: 10 }),
				pos({ symbol: 'C', quantity: 10 }),
			],
			new Map([
				['A', 500],
				['B', 300],
				['C', 200],
			])
		);
		expect(valued.map((v) => v.marketValueMinor)).toEqual([5000, 3000, 2000]);
		expect(valued.map((v) => v.weightPct)).toEqual([50, 30, 20]);
		expect(valued.every((v) => v.priced)).toBe(true);
		expect(topPositions(valued, 2)).toEqual([
			{ symbol: 'A', weightPct: 50 },
			{ symbol: 'B', weightPct: 30 },
		]);
	});

	it('values by cost without a quote and flags priced:false', () => {
		const [v] = valuePositions([pos({ costMinor: 12345 })], new Map());
		expect(v.marketValueMinor).toBe(12345);
		expect(v.priced).toBe(false);
	});

	it('ignores a non-positive close', () => {
		const [v] = valuePositions([pos({ costMinor: 700 })], new Map([['A', 0]]));
		expect(v.marketValueMinor).toBe(700);
		expect(v.priced).toBe(false);
	});

	it('zero-value portfolio: weights 0, not NaN', () => {
		const valued = valuePositions([pos({ costMinor: 0 })], new Map());
		expect(valued[0].weightPct).toBe(0);
		expect(Object.values(allocationByClass(valued)).every((n) => n === 0)).toBe(
			true
		);
		expect(
			Object.values(liquidityBreakdown(valued)).every((n) => n === 0)
		).toBe(true);
	});

	it('portfolio provenance', () => {
		const v = pos({ provenance: Provenance.Verified });
		const m = pos({ provenance: Provenance.Manual });
		expect(portfolioProvenance([v, v])).toBe(PortfolioProvenance.Verified);
		expect(portfolioProvenance([m, m])).toBe(PortfolioProvenance.Manual);
		expect(portfolioProvenance([v, m])).toBe(PortfolioProvenance.Partial);
		expect(portfolioProvenance([])).toBeNull();
	});

	it('liquidity: class default, override and unknown', () => {
		const valued = valuePositions(
			[
				pos({ symbol: 'S', costMinor: 6000 }),
				pos({ symbol: 'C', assetClass: AssetClass.Crypto, costMinor: 1000 }),
				pos({
					symbol: 'F',
					assetClass: AssetClass.Fund,
					liquidityDays: 30,
					costMinor: 2000,
				}),
				pos({
					symbol: 'R',
					assetClass: AssetClass.FixedIncome,
					costMinor: 1000,
				}),
			],
			new Map()
		);
		expect(liquidityBreakdown(valued)).toEqual({
			[LiquidityBucket.D0]: 10,
			[LiquidityBucket.D1_2]: 60,
			[LiquidityBucket.D3_30]: 20,
			[LiquidityBucket.D31Plus]: 0,
			[LiquidityBucket.Unknown]: 10,
		});
	});

	it('allocation by class has a key for every class', () => {
		const valued = valuePositions(
			[
				pos({ symbol: 'A', costMinor: 750 }),
				pos({ symbol: 'B', assetClass: AssetClass.Fii, costMinor: 250 }),
			],
			new Map()
		);
		const alloc = allocationByClass(valued);
		expect(Object.keys(alloc).sort()).toEqual(Object.values(AssetClass).sort());
		expect(alloc[AssetClass.Stock]).toBe(75);
		expect(alloc[AssetClass.Fii]).toBe(25);
		expect(alloc[AssetClass.Crypto]).toBe(0);
	});

	it('drift from target in percentage points', () => {
		const current = allocationByClass(
			valuePositions(
				[
					pos({ symbol: 'A', costMinor: 750 }),
					pos({ symbol: 'B', assetClass: AssetClass.Fii, costMinor: 250 }),
				],
				new Map()
			)
		);
		const drift = allocationDrift(current, {
			[AssetClass.Stock]: 60,
			[AssetClass.Fii]: 30,
			[AssetClass.FixedIncome]: 10,
		});
		expect(drift[AssetClass.Stock]).toBe(15);
		expect(drift[AssetClass.Fii]).toBe(-5);
		expect(drift[AssetClass.FixedIncome]).toBe(-10);
		expect(drift[AssetClass.Crypto]).toBe(0);
		expect(Object.keys(drift)).toHaveLength(Object.values(AssetClass).length);
	});
});
