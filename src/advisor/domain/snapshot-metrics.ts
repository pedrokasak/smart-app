import {
	AssetClass,
	LiquidityBucket,
	PortfolioProvenance,
	Provenance,
} from './enums';
import { Position } from './portfolio.entities';

export interface ValuedPosition extends Position {
	/** A mercado; sem cotação, o custo. */
	marketValueMinor: number;
	priced: boolean;
	/** 0-100, sobre o total. */
	weightPct: number;
	/**
	 * Variação do último fechamento contra o de 5 pregões antes, em % com
	 * sinal. `null` sem cotação ou com menos de 6 fechamentos.
	 */
	change5dPct: number | null;
	/** Data do último fechamento usado; `null` sem cotação. */
	lastCloseDate: string | null;
}

export const DEFAULT_LIQUIDITY_DAYS: Partial<Record<AssetClass, number>> = {
	[AssetClass.Stock]: 2,
	[AssetClass.Fii]: 2,
	[AssetClass.Etf]: 2,
	[AssetClass.Crypto]: 0,
};

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

const pct = (part: number, total: number): number =>
	total > 0 ? round4((part / total) * 100) : 0;

const zeroed = <K extends string>(keys: K[]): Record<K, number> =>
	Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function valuePositions(
	positions: Position[],
	lastCloseMinor: Map<string, number>
): ValuedPosition[] {
	const base = positions.map((p) => {
		const close = lastCloseMinor.get(p.symbol);
		const priced = close !== undefined && Number.isFinite(close) && close > 0;
		return {
			...p,
			marketValueMinor: priced ? Math.round(p.quantity * close) : p.costMinor,
			priced,
		};
	});
	const total = base.reduce((sum, p) => sum + p.marketValueMinor, 0);
	return base.map((p) => ({
		...p,
		weightPct: pct(p.marketValueMinor, total),
		change5dPct: null,
		lastCloseDate: null,
	}));
}

export function portfolioProvenance(
	positions: Position[]
): PortfolioProvenance | null {
	if (positions.length === 0) return null;
	const verified = positions.filter(
		(p) => p.provenance === Provenance.Verified
	).length;
	if (verified === positions.length) return PortfolioProvenance.Verified;
	if (verified === 0) return PortfolioProvenance.Manual;
	return PortfolioProvenance.Partial;
}

export function liquidityBucketOf(
	position: Pick<Position, 'assetClass' | 'liquidityDays'>
): LiquidityBucket {
	const days =
		position.liquidityDays ?? DEFAULT_LIQUIDITY_DAYS[position.assetClass];
	if (days === undefined) return LiquidityBucket.Unknown;
	if (days <= 0) return LiquidityBucket.D0;
	if (days <= 2) return LiquidityBucket.D1_2;
	if (days <= 30) return LiquidityBucket.D3_30;
	return LiquidityBucket.D31Plus;
}

export function liquidityBreakdown(
	valued: ValuedPosition[]
): Record<LiquidityBucket, number> {
	const total = valued.reduce((sum, p) => sum + p.marketValueMinor, 0);
	const sums = zeroed(Object.values(LiquidityBucket));
	for (const p of valued) sums[liquidityBucketOf(p)] += p.marketValueMinor;
	for (const key of Object.values(LiquidityBucket)) {
		sums[key] = pct(sums[key], total);
	}
	return sums;
}

export function allocationByClass(
	valued: ValuedPosition[]
): Record<AssetClass, number> {
	const total = valued.reduce((sum, p) => sum + p.marketValueMinor, 0);
	const sums = zeroed(Object.values(AssetClass));
	for (const p of valued) sums[p.assetClass] += p.marketValueMinor;
	for (const key of Object.values(AssetClass)) {
		sums[key] = pct(sums[key], total);
	}
	return sums;
}

/** Pontos percentuais: atual - meta. */
export function allocationDrift(
	current: Record<AssetClass, number>,
	targets: Partial<Record<AssetClass, number>>
): Record<AssetClass, number> {
	const drift = zeroed(Object.values(AssetClass));
	for (const key of Object.values(AssetClass)) {
		drift[key] = round4((current[key] ?? 0) - (targets[key] ?? 0));
	}
	return drift;
}

export function topPositions(
	valued: ValuedPosition[],
	n: number
): Array<{ symbol: string; weightPct: number }> {
	return [...valued]
		.sort((a, b) => b.weightPct - a.weightPct)
		.slice(0, Math.max(0, n))
		.map((p) => ({ symbol: p.symbol, weightPct: p.weightPct }));
}
