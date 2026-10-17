import { Trade } from 'src/fiscal/domain/trade';
import {
	type CostBasisPosition,
	applyBuy,
	applySell,
	averageCost,
} from 'src/fiscal/domain/cost-basis';

export interface AveragePriceResult {
	quantity: number;
	averagePrice: number;
}

export class AveragePriceService {
	/**
	 * Preço médio (custo médio ponderado) a partir dos trades, pela mesma
	 * regra do motor de IR (`fiscal/domain/cost-basis`). Venda maior que a
	 * posição zera a posição em vez de lançar: os trades vêm de imports que
	 * podem estar incompletos.
	 */
	calculate(trades: Trade[]): AveragePriceResult {
		let position: CostBasisPosition = { quantity: 0, totalCost: 0 };

		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);

		for (const t of sorted) {
			position =
				t.side === 'buy'
					? applyBuy(position, t.quantity, t.price, t.fees ?? 0)
					: applySell(position, t.quantity).position;
		}

		return {
			quantity: position.quantity,
			averagePrice: averageCost(position),
		};
	}
}
