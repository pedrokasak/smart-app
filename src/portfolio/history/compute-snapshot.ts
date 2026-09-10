/**
 * Calcula o snapshot diário da carteira marcado a mercado (TRA-143).
 *
 * ## Por que isto existe
 *
 * O snapshot diário somava `asset.total`, que é `quantity * costBasis`
 * (`assets.service.ts`) — ou seja, **custo de aquisição**. Custo não varia
 * enquanto o usuário não negocia, então a série gravava o mesmo número todo
 * dia e o gráfico saía reto.
 *
 * O diagnóstico corrente era "as fontes de cotação não estão ligadas". Não
 * era isso: `currentPrice` é populado e o refresh de cotação roda de 6 em 6
 * horas. O snapshot apenas lia o campo errado — e o resto do código já lia o
 * certo (`ai.controller.ts`, `chat-orchestrator.service.ts` e outros preferem
 * `currentPrice` quando ele existe).
 *
 * ## O que muda
 *
 * `totalValue` passa a ser posição a preço de mercado. `investedValue` guarda
 * o custo, que antes ocupava o lugar do valor. Com os dois separados, a
 * diferença entre eles é retorno não realizado — a decomposição "aporte vs
 * rendimento" que falta nas três telas (TRA-146) deixa de exigir cálculo novo.
 *
 * ## Honestidade sobre o dado
 *
 * Um ativo sem `currentPrice` é valorizado pelo custo e o snapshot inteiro sai
 * marcado como `stale`, listando quais símbolos faltaram. Sem isso, uma
 * carteira parcialmente sem cotação produziria um `totalValue` que parece
 * marcado a mercado e não é — o mesmo tipo de mentira conveniente que levou a
 * remover o preço-alvo fabricado (TRA-55).
 */

export interface SnapshotAssetInput {
	symbol?: string;
	quantity?: number;
	/** Preço de entrada. Base de custo, não valor de mercado. */
	price?: number;
	/** Cotação mais recente conhecida. Ausente quando nunca foi buscada. */
	currentPrice?: number | null;
}

export interface ComputedSnapshot {
	/** Posição a preço de mercado. */
	totalValue: number;
	/** Custo de aquisição acumulado. */
	investedValue: number;
	/** true quando ao menos um ativo caiu para o custo por falta de cotação. */
	stale: boolean;
	/** Símbolos sem cotação, para o log e para a interface poder explicar. */
	staleSymbols: string[];
	/** Quantos ativos entraram no cálculo. */
	pricedAssets: number;
}

const toNumber = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

export function computePortfolioSnapshot(
	assets: SnapshotAssetInput[]
): ComputedSnapshot {
	let totalValue = 0;
	let investedValue = 0;
	const staleSymbols: string[] = [];
	let pricedAssets = 0;

	for (const asset of assets || []) {
		const quantity = toNumber(asset?.quantity);
		if (quantity <= 0) continue;

		const entryPrice = toNumber(asset?.price);
		const cost = quantity * entryPrice;
		investedValue += cost;
		pricedAssets += 1;

		const quote = asset?.currentPrice;
		const hasQuote = typeof quote === 'number' && Number.isFinite(quote) && quote > 0;

		if (hasQuote) {
			totalValue += quantity * (quote as number);
			continue;
		}

		// Sem cotação: vale o custo, e o snapshot inteiro fica marcado. Cair
		// para o custo em silêncio é o que produzia a curva reta.
		totalValue += cost;
		const symbol = String(asset?.symbol || '').toUpperCase();
		if (symbol && !staleSymbols.includes(symbol)) {
			staleSymbols.push(symbol);
		}
	}

	return {
		totalValue: Number(totalValue.toFixed(2)),
		investedValue: Number(investedValue.toFixed(2)),
		stale: staleSymbols.length > 0,
		staleSymbols,
		pricedAssets,
	};
}
