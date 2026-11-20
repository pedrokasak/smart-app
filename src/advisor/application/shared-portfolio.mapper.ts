import { Provenance, TransactionSource } from '../domain/enums';
import { Position, Transaction } from '../domain/portfolio.entities';
import { derivePositions } from '../domain/positions';
import type {
	SharedHolding,
	SharedPortfolioData,
	SharedTrade,
} from './ports/shared-portfolio-source.port';

export interface ReconciledPortfolio {
	/** Transações sintéticas: alimentam só o cálculo, nunca são gravadas. */
	ledger: Transaction[];
	/** Ativos cadastrados que as negociações não explicam. */
	holdingsWithoutHistory: Position[];
	/**
	 * Símbolos fora de tudo (nem ledger, nem posição): negociações sem ativo
	 * cadastrado que não fecham em zero (posição aberta ou histórico
	 * inconsistente) e ativos com quantidade ou custo não finitos.
	 */
	unreconciledSymbols: string[];
}

const RELATIVE_TOLERANCE = 1e-6;

const matches = (derived: number, held: number): boolean =>
	Math.abs(derived - held) <= RELATIVE_TOLERANCE * Math.max(1, held);

const isValidTrade = (t: SharedTrade): boolean =>
	Number.isFinite(t.quantity) &&
	t.quantity > 0 &&
	Number.isFinite(t.unitPriceMinor) &&
	t.unitPriceMinor >= 0 &&
	Number.isFinite(t.feesMinor) &&
	t.feesMinor >= 0;

function toTransaction(
	t: SharedTrade,
	index: number,
	portfolioId: string,
	ids: { orgId: string; clientProfileId: string }
): Transaction {
	return {
		id: `${portfolioId}:${index}`,
		orgId: ids.orgId,
		clientProfileId: ids.clientProfileId,
		symbol: t.symbol,
		assetClass: t.assetClass,
		side: t.side,
		quantity: t.quantity,
		unitPriceMinor: t.unitPriceMinor,
		feesMinor: t.feesMinor,
		currency: 'BRL',
		tradeDate: t.tradeDate,
		provenance: t.provenance,
		source:
			t.provenance === Provenance.Verified
				? TransactionSource.CsvImport
				: TransactionSource.ManualEntry,
		createdByUserId: '',
		createdAt: t.createdAt,
	};
}

const isValidHolding = (h: SharedHolding): boolean =>
	Number.isFinite(h.quantity) && Number.isFinite(h.costMinor);

/** Um ativo por símbolo; duplicados somam quantidade e custo. */
function holdingsBySymbol(holdings: SharedHolding[]): Map<string, Position> {
	const bySymbol = new Map<string, Position>();
	for (const h of holdings) {
		const current = bySymbol.get(h.symbol);
		bySymbol.set(h.symbol, {
			symbol: h.symbol,
			assetClass: current?.assetClass ?? h.assetClass,
			quantity: (current?.quantity ?? 0) + h.quantity,
			costMinor: (current?.costMinor ?? 0) + h.costMinor,
			provenance:
				(current?.provenance ?? Provenance.Verified) === Provenance.Verified &&
				h.provenance === Provenance.Verified
					? Provenance.Verified
					: Provenance.Manual,
		});
	}
	return bySymbol;
}

/**
 * Concilia, por símbolo, as negociações com os ativos cadastrados de uma
 * carteira B2C. Na dúvida, o ativo cadastrado vale e o símbolo fica sem
 * histórico: nunca um retorno calculado sobre uma história que não fecha.
 */
export function reconcileSharedPortfolio(
	data: SharedPortfolioData,
	ids: { orgId: string; clientProfileId: string }
): ReconciledPortfolio {
	const holdings = holdingsBySymbol(data.holdings);
	// Falha fechado: um ativo com número inválido tira o símbolo inteiro.
	const invalidHoldingSymbols = new Set(
		data.holdings.filter((h) => !isValidHolding(h)).map((h) => h.symbol)
	);
	const all = data.trades.map((t, index) =>
		toTransaction(t, index, data.portfolioId, ids)
	);
	const invalidSymbols = new Set(
		data.trades.filter((t) => !isValidTrade(t)).map((t) => t.symbol)
	);
	const tradesBySymbol = new Map<string, Transaction[]>();
	for (const t of all) {
		tradesBySymbol.set(t.symbol, [...(tradesBySymbol.get(t.symbol) ?? []), t]);
	}

	const reconciled = new Set<string>();
	const holdingsWithoutHistory: Position[] = [];
	const unreconciledSymbols: string[] = [];
	const symbols = new Set([...holdings.keys(), ...tradesBySymbol.keys()]);
	for (const symbol of symbols) {
		if (invalidHoldingSymbols.has(symbol)) {
			unreconciledSymbols.push(symbol);
			continue;
		}
		const held = holdings.get(symbol);
		const trades = tradesBySymbol.get(symbol) ?? [];
		const derived = derivePositions(trades);
		const consistent =
			trades.length > 0 &&
			!invalidSymbols.has(symbol) &&
			derived.inconsistencies.length === 0;
		const derivedQuantity = derived.positions[0]?.quantity ?? 0;

		if (held) {
			if (consistent && matches(derivedQuantity, held.quantity)) {
				reconciled.add(symbol);
			} else {
				holdingsWithoutHistory.push(held);
			}
		} else if (consistent && matches(derivedQuantity, 0)) {
			reconciled.add(symbol);
		} else {
			unreconciledSymbols.push(symbol);
		}
	}

	return {
		ledger: all.filter((t) => reconciled.has(t.symbol)),
		holdingsWithoutHistory: holdingsWithoutHistory.sort((a, b) =>
			a.symbol.localeCompare(b.symbol)
		),
		unreconciledSymbols: unreconciledSymbols.sort(),
	};
}
