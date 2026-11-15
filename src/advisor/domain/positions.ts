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

export function derivePositions(ledger: Transaction[]): DerivedPortfolio {
	const open = new Map<string, OpenPosition>();
	const inconsistencies: string[] = [];

	for (const t of sortLedger(ledger)) {
		const current = open.get(t.symbol);

		if (t.side === TransactionSide.Buy) {
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
			continue;
		}

		if (!current || t.quantity > current.quantity + QUANTITY_EPSILON) {
			inconsistencies.push(`${t.symbol}@${t.tradeDate}`);
			open.delete(t.symbol);
			continue;
		}

		const remaining = current.quantity - t.quantity;
		if (remaining < QUANTITY_EPSILON) {
			open.delete(t.symbol);
			continue;
		}
		open.set(t.symbol, {
			...current,
			quantity: remaining,
			costMinor:
				current.costMinor -
				Math.round((current.costMinor * t.quantity) / current.quantity),
			allVerified: current.allVerified && t.provenance === Provenance.Verified,
			liquidityDays: t.liquidityDays ?? current.liquidityDays,
		});
	}

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
	ledger: Array<
		Pick<
			Transaction,
			'symbol' | 'side' | 'quantity' | 'tradeDate' | 'createdAt'
		>
	>
): { symbol: string; tradeDate: string } | null {
	const held = new Map<string, number>();
	for (const t of sortLedger(ledger)) {
		const balance = held.get(t.symbol) ?? 0;
		if (t.side === TransactionSide.Buy) {
			held.set(t.symbol, balance + t.quantity);
			continue;
		}
		if (t.quantity > balance + QUANTITY_EPSILON) {
			return { symbol: t.symbol, tradeDate: t.tradeDate };
		}
		held.set(t.symbol, balance - t.quantity);
	}
	return null;
}
