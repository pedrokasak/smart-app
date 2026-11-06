import {
	type AllocationBucket,
	positionValue,
	toAllocationBucket,
} from 'src/portfolio/target-allocation/application/allocation-exposure';

export interface WalletAsset {
	symbol?: string | null;
	name?: string | null;
	type?: string | null;
	quantity?: number | null;
	/** Preço médio de compra. */
	price?: number | null;
	avgPrice?: number | null;
	total?: number | null;
	currentPrice?: number | null;
}

export interface WalletPosition {
	symbol: string;
	name: string | null;
	bucket: AllocationBucket;
	quantity: number;
	value: number;
	cost: number;
	/** Resultado sobre o custo, em %. `null` sem custo conhecido. */
	resultPct: number | null;
	weightPct: number;
	/** Peso acima do limite por ativo da política da carteira. */
	overLimit: boolean;
}

export interface Wallet {
	totalValue: number;
	totalCost: number;
	result: number;
	resultPct: number | null;
	/** Menor limite por ativo entre as carteiras com política. */
	maxPositionPct: number | null;
	positions: WalletPosition[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Posições somadas por símbolo entre todas as carteiras, a valor de mercado.
 * Usa o mesmo `positionValue` da alocação, para o peso bater com a home.
 */
export function buildWallet(
	assets: WalletAsset[],
	maxPositionPct: number | null
): Wallet {
	const bySymbol = new Map<
		string,
		Omit<WalletPosition, 'resultPct' | 'weightPct' | 'overLimit'>
	>();
	for (const asset of assets || []) {
		const symbol = String(asset?.symbol || '').toUpperCase();
		const quantity = Number(asset?.quantity) || 0;
		const value = positionValue(asset);
		if (!symbol || !(value > 0)) continue;
		const averagePrice = Number(asset?.avgPrice ?? asset?.price) || 0;
		const current = bySymbol.get(symbol) ?? {
			symbol,
			name: asset?.name ?? null,
			bucket: toAllocationBucket(asset?.type),
			quantity: 0,
			value: 0,
			cost: 0,
		};
		current.quantity += quantity;
		current.value += value;
		current.cost += averagePrice * quantity;
		bySymbol.set(symbol, current);
	}

	const rows = [...bySymbol.values()];
	const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
	const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
	const positions = rows
		.map((row) => {
			const weightPct = totalValue > 0 ? (row.value / totalValue) * 100 : 0;
			return {
				...row,
				value: round2(row.value),
				cost: round2(row.cost),
				resultPct:
					row.cost > 0 ? round2((row.value / row.cost - 1) * 100) : null,
				weightPct: round2(weightPct),
				overLimit: maxPositionPct !== null && weightPct > maxPositionPct,
			};
		})
		.sort((a, b) => b.value - a.value);

	return {
		totalValue: round2(totalValue),
		totalCost: round2(totalCost),
		result: round2(totalValue - totalCost),
		resultPct:
			totalCost > 0 ? round2((totalValue / totalCost - 1) * 100) : null,
		maxPositionPct,
		positions,
	};
}

/** O limite mais apertado vale: é o que a pessoa disse que não quer passar. */
export function strictestPositionLimit(
	portfolios: Array<{ policy?: { maxPositionPct?: number | null } | null }>
): number | null {
	const limits = (portfolios || [])
		.map((portfolio) => Number(portfolio?.policy?.maxPositionPct))
		.filter((limit) => Number.isFinite(limit) && limit > 0);
	return limits.length ? Math.min(...limits) : null;
}
