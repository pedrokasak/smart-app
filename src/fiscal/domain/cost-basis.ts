/**
 * Custo médio ponderado (TRA-232): a única regra de preço médio do sistema,
 * usada pelo motor de IR e pelo preço médio exibido na carteira. Antes cada
 * um tinha a sua, e a da carteira não tirava o custo na venda parcial:
 * compra 100 @ R$ 10 e venda de 50 viravam PM de R$ 20.
 *
 * - Compra soma quantidade e custo (preço × quantidade + taxas).
 * - Venda tira a quantidade e o custo proporcional ao PM do momento; o PM
 *   do que sobra não muda. Taxa de venda não entra no custo (ela reduz o
 *   resultado da venda, que é conta de quem apura o IR).
 * - Posição zerada zera o custo.
 *
 * Venda maior que a posição é decisão de quem chama: o motor de IR recusa;
 * a carteira, que lê imports incompletos, zera a posição.
 */

import type { CorporateEvent } from './corporate-event';

export interface CostBasisPosition {
	quantity: number;
	totalCost: number;
}

export function averageCost(position: CostBasisPosition): number {
	return position.quantity > 0 ? position.totalCost / position.quantity : 0;
}

export function applyBuy(
	position: CostBasisPosition,
	quantity: number,
	unitPrice: number,
	fees = 0
): CostBasisPosition {
	return {
		quantity: position.quantity + quantity,
		totalCost: position.totalCost + quantity * unitPrice + fees,
	};
}

/** Devolve a posição restante e o custo que saiu com a venda. */
export function applySell(
	position: CostBasisPosition,
	quantity: number
): { position: CostBasisPosition; costBasis: number } {
	const sold = Math.min(quantity, Math.max(position.quantity, 0));
	const costBasis = sold * averageCost(position);
	const remaining = position.quantity - sold;
	if (remaining <= 0) {
		return { position: { quantity: 0, totalCost: 0 }, costBasis };
	}
	return {
		position: {
			quantity: remaining,
			totalCost: position.totalCost - costBasis,
		},
		costBasis,
	};
}

/**
 * Desdobramento e grupamento mudam a quantidade e mantêm o custo total (o PM
 * se ajusta sozinho). Bonificação soma as ações novas e o custo atribuído.
 * Fração de ação fica de fora: a companhia leiloa e paga em dinheiro, o que
 * entra como venda quando vier do extrato.
 */
export function applyCorporateEvent(
	position: CostBasisPosition,
	event: Pick<CorporateEvent, 'type' | 'ratio' | 'bonusUnitCost'>
): CostBasisPosition {
	if (position.quantity <= 0) return position;
	if (event.type === 'BONUS') {
		const newShares = Math.floor(position.quantity * event.ratio);
		return {
			quantity: position.quantity + newShares,
			totalCost: position.totalCost + newShares * (event.bonusUnitCost ?? 0),
		};
	}
	return {
		quantity: Math.floor(position.quantity * event.ratio),
		totalCost: position.totalCost,
	};
}
