import { Injectable } from '@nestjs/common';
import { Trade } from 'src/fiscal/domain/trade';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';

export interface MonthlyPnl {
	year: number;
	month: number; // 1-12
	realizedPnl: number;
}

@Injectable()
export class FiscalService {
	constructor(private readonly averagePriceService: AveragePriceService) {}

	calculateAveragePrice(trades: Trade[]) {
		return this.averagePriceService.calculate(trades);
	}

	/**
	 * PnL realizado mensal (simplificado): assume FIFO/PM? Aqui usamos PM:
	 * para cada venda, lucro = (sellPrice - averagePriceAtThatTime) * qty - fees.
	 * OBS: ainda não trata regras de IR (isenção, day trade, etc). É o "motor" base.
	 */
	calculateMonthlyRealizedPnl(trades: Trade[]): MonthlyPnl[] {
		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);

		let qty = 0;
		let totalCost = 0;
		const byMonth = new Map<string, MonthlyPnl>();

		for (const t of sorted) {
			const fees = t.fees ?? 0;

			if (t.side === 'buy') {
				totalCost += t.quantity * t.price + fees;
				qty += t.quantity;
				continue;
			}

			// sell
			const avg = qty > 0 ? totalCost / qty : 0;
			const realized = (t.price - avg) * t.quantity - fees;

			const y = t.date.getFullYear();
			const m = t.date.getMonth() + 1;
			const key = `${y}-${m}`;
			const cur = byMonth.get(key) ?? { year: y, month: m, realizedPnl: 0 };
			cur.realizedPnl += realized;
			byMonth.set(key, cur);

			// reduce position/cost using PM
			qty -= t.quantity;
			totalCost -= avg * t.quantity;
			if (qty <= 0) {
				qty = 0;
				totalCost = 0;
			}
		}

		return Array.from(byMonth.values()).sort((a, b) =>
			a.year !== b.year ? a.year - b.year : a.month - b.month
		);
	}
}

