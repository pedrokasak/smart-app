import { Trade } from 'src/fiscal/domain/trade';
import { type CorporateEvent, exDay } from 'src/fiscal/domain/corporate-event';
import {
	type CostBasisPosition,
	applyBuy,
	applyCorporateEvent,
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
	 * regra do motor de IR (`fiscal/domain/cost-basis`), com os eventos
	 * corporativos do ativo (`events`, todos do mesmo símbolo dos trades)
	 * aplicados na data ex (TRA-231). Venda maior que a
	 * posição zera a posição em vez de lançar: os trades vêm de imports que
	 * podem estar incompletos.
	 */
	calculate(
		trades: Trade[],
		events: CorporateEvent[] = []
	): AveragePriceResult {
		let position: CostBasisPosition = { quantity: 0, totalCost: 0 };

		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);
		// Evento na data ex vale antes dos negócios do mesmo dia: quem compra
		// na data ex já compra "ex".
		const pending = [...events].sort((a, b) => exDay(a) - exDay(b));
		const applyEventsUntil = (day: number) => {
			while (pending.length && exDay(pending[0]) <= day) {
				position = applyCorporateEvent(position, pending.shift()!);
			}
		};

		for (const t of sorted) {
			applyEventsUntil(exDay({ exDate: t.date }));
			position =
				t.side === 'buy'
					? applyBuy(position, t.quantity, t.price, t.fees ?? 0)
					: applySell(position, t.quantity).position;
		}
		applyEventsUntil(Number.POSITIVE_INFINITY);

		return {
			quantity: position.quantity,
			averagePrice: averageCost(position),
		};
	}
}
