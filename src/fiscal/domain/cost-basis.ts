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
