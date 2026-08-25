import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import type { Trade } from 'src/fiscal/domain/trade';

export interface DerivableAsset {
	symbol: string;
	avgPrice?: number;
	/** Cotação atual. Usada para detectar o custo corrompido — ver abaixo. */
	price?: number;
	source?: string;
}

/**
 * Até a correção do importador consolidado, `importB3Report` gravava
 * `avgPrice: assetData.price` ao atualizar um ativo — a cotação de
 * fechamento do relatório entrando como se fosse o custo de aquisição.
 * O resultado é P&L exatamente zero por construção: custo igual a valor
 * de mercado.
 *
 * Remover aquela linha impediu novas gravações, mas não curou o que já
 * está no banco: quem importou antes continua com o custo errado, e a
 * derivação por negociações o respeitava por ser um número maior que
 * zero.
 *
 * Um ativo de origem `b3` cujo custo é exatamente igual à cotação carrega
 * a assinatura daquela gravação: era o único caminho que escrevia
 * `avgPrice` em ativo vindo do relatório. Tratamos esse valor como custo
 * desconhecido na leitura — sem alterar o banco, então nada se perde e a
 * decisão é reversível.
 */
function hasCorruptedImportCost(asset: DerivableAsset): boolean {
	if (asset.source !== 'b3') return false;
	const avgPrice = Number(asset.avgPrice);
	const price = Number(asset.price);
	if (!(avgPrice > 0) || !(price > 0)) return false;
	return Math.abs(avgPrice - price) < 1e-9;
}

export interface DerivableTrade {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees?: number;
	date: Date;
}

const averagePriceService = new AveragePriceService();

export function withDerivedAveragePrice<T extends DerivableAsset>(
	assets: T[],
	trades: DerivableTrade[]
): T[] {
	const tradesBySymbol = new Map<string, Trade[]>();
	for (const trade of trades) {
		const key = String(trade.symbol || '').toUpperCase();
		if (!key) continue;
		const list = tradesBySymbol.get(key) ?? [];
		list.push({
			assetSymbol: key,
			side: trade.side,
			quantity: Number(trade.quantity) || 0,
			price: Number(trade.price) || 0,
			fees: Number(trade.fees) || 0,
			date: trade.date,
		});
		tradesBySymbol.set(key, list);
	}

	return assets.map((asset) => {
		const costIsCorrupted = hasCorruptedImportCost(asset);

		// Valor manual sempre vence: foi o usuário que digitou, ou o
		// broker-sync que já calculou na importação da nota. A exceção é o
		// custo corrompido pelo importador antigo, que não veio de ninguém.
		if (
			typeof asset.avgPrice === 'number' &&
			asset.avgPrice > 0 &&
			!costIsCorrupted
		) {
			return asset;
		}

		const symbolTrades = tradesBySymbol.get(
			String(asset.symbol || '').toUpperCase()
		);

		// Sem negociação para recalcular: devolve o ativo sem custo, para o
		// P&L aparecer como indisponível em vez de zero — zero é uma
		// afirmação, e é falsa.
		if (!symbolTrades?.length) {
			return costIsCorrupted ? { ...asset, avgPrice: undefined } : asset;
		}

		const { averagePrice } = averagePriceService.calculate(symbolTrades);

		// Posição zerada devolve 0. Gravar esse 0 recriaria exatamente o bug
		// que este trabalho corrige — custo zero lido como "de graça".
		if (!(averagePrice > 0)) {
			return costIsCorrupted ? { ...asset, avgPrice: undefined } : asset;
		}

		return { ...asset, avgPrice: averagePrice };
	});
}
