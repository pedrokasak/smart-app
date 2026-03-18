import { Trade } from 'src/fiscal/domain/trade';

export interface AveragePriceResult {
	quantity: number;
	averagePrice: number;
}

export class AveragePriceService {
	/**
	 * Calcula preço médio (custo médio) a partir de trades.
	 * Regra: compras aumentam posição e recalculam PM; vendas reduzem posição e não alteram PM do remanescente.
	 * Taxas podem ser incorporadas ao custo (fees).
	 */
	calculate(trades: Trade[]): AveragePriceResult {
		let qty = 0;
		let totalCost = 0;

		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);

		for (const t of sorted) {
			if (t.side === 'buy') {
				const fees = t.fees ?? 0;
				totalCost += t.quantity * t.price + fees;
				qty += t.quantity;
			} else {
				// sell
				qty -= t.quantity;
				if (qty <= 0) {
					// posição zerada: PM volta a 0
					qty = 0;
					totalCost = 0;
				}
			}
		}

		return {
			quantity: qty,
			averagePrice: qty > 0 ? totalCost / qty : 0,
		};
	}
}
