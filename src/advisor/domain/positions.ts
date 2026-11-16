import { AssetClass, Provenance, TransactionSide } from './enums';
import { Position, Transaction } from './portfolio.entities';

export interface DerivedPortfolio {
	positions: Position[];
	inconsistencies: string[];
}

const QUANTITY_EPSILON = 1e-8;

type LedgerItem = Pick<Transaction, 'tradeDate' | 'side' | 'createdAt'>;

function sideRank(side: TransactionSide): number {
	return side === TransactionSide.Buy ? 0 : 1;
}

export function sortLedger<T extends LedgerItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		if (a.tradeDate !== b.tradeDate) {
			return a.tradeDate < b.tradeDate ? -1 : 1;
		}
		const bySide = sideRank(a.side) - sideRank(b.side);
		if (bySide !== 0) return bySide;
		return a.createdAt.getTime() - b.createdAt.getTime();
	});
}

interface OpenPosition {
	symbol: string;
	assetClass: AssetClass;
	quantity: number;
	costMinor: number;
	allVerified: boolean;
	liquidityDays?: number;
}

type QuantityItem = Pick<
	Transaction,
	'symbol' | 'side' | 'quantity' | 'tradeDate' | 'createdAt'
>;

interface LedgerVisitor<T extends QuantityItem> {
	buy(t: T): void;
	sell(t: T, heldBefore: number, closes: boolean): void;
	/** Returns true to stop the walk. */
	oversell(t: T): boolean;
}

/**
 * The single per-symbol walk behind both derivePositions and findOversell,
 * so the write-time check and the read-time derivation cannot disagree.
 * A sell is an oversell when there is no open position or when it exceeds
 * the balance by more than the epsilon; an oversell closes the position.
 */
function walkLedger<T extends QuantityItem>(
	ledger: T[],
	visitor: LedgerVisitor<T>
): void {
	const held = new Map<string, number>();
	for (const t of sortLedger(ledger)) {
		const balance = held.get(t.symbol);
		if (t.side === TransactionSide.Buy) {
			held.set(t.symbol, (balance ?? 0) + t.quantity);
			visitor.buy(t);
			continue;
		}
		if (balance === undefined || t.quantity > balance + QUANTITY_EPSILON) {
			held.delete(t.symbol);
			if (visitor.oversell(t)) return;
			continue;
		}
		const remaining = balance - t.quantity;
		const closes = remaining < QUANTITY_EPSILON;
		if (closes) held.delete(t.symbol);
		else held.set(t.symbol, remaining);
		visitor.sell(t, balance, closes);
	}
}

export function derivePositions(ledger: Transaction[]): DerivedPortfolio {
	const open = new Map<string, OpenPosition>();
	const inconsistencies: string[] = [];

	walkLedger(ledger, {
		buy(t) {
			const current = open.get(t.symbol);
			const cost = Math.round(t.quantity * t.unitPriceMinor) + t.feesMinor;
			open.set(t.symbol, {
				symbol: t.symbol,
				assetClass: t.assetClass,
				quantity: (current?.quantity ?? 0) + t.quantity,
				costMinor: (current?.costMinor ?? 0) + cost,
				allVerified:
					(current?.allVerified ?? true) &&
					t.provenance === Provenance.Verified,
				liquidityDays: t.liquidityDays ?? current?.liquidityDays,
			});
		},
		sell(t, heldBefore, closes) {
			if (closes) {
				open.delete(t.symbol);
				return;
			}
			const current = open.get(t.symbol);
			open.set(t.symbol, {
				...current,
				quantity: heldBefore - t.quantity,
				costMinor:
					current.costMinor -
					Math.round((current.costMinor * t.quantity) / heldBefore),
				allVerified:
					current.allVerified && t.provenance === Provenance.Verified,
				liquidityDays: t.liquidityDays ?? current.liquidityDays,
			});
		},
		oversell(t) {
			inconsistencies.push(`${t.symbol}@${t.tradeDate}`);
			open.delete(t.symbol);
			return false;
		},
	});

	const positions: Position[] = [...open.values()].map((p) => ({
		symbol: p.symbol,
		assetClass: p.assetClass,
		quantity: p.quantity,
		costMinor: p.costMinor,
		provenance: p.allVerified ? Provenance.Verified : Provenance.Manual,
		...(p.liquidityDays !== undefined && { liquidityDays: p.liquidityDays }),
	}));
	return { positions, inconsistencies };
}

export function findOversell(
	ledger: QuantityItem[]
): { symbol: string; tradeDate: string } | null {
	let found: { symbol: string; tradeDate: string } | null = null;
	walkLedger(ledger, {
		buy: () => undefined,
		sell: () => undefined,
		oversell(t) {
			found = { symbol: t.symbol, tradeDate: t.tradeDate };
			return true;
		},
	});
	return found;
}
