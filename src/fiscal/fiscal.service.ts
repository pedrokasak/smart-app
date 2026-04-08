import { Injectable } from '@nestjs/common';
import { Trade } from 'src/fiscal/domain/trade';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';

export interface MonthlyPnl {
	year: number;
	month: number; // 1-12
	realizedPnl: number;
}

export interface MonthlyTaxSummary {
	year: number;
	month: number;
	stockSales: number;
	stockProfit: number;
	fiiProfit: number;
	cryptoProfit: number;
	stockTax: number;
	fiiTax: number;
	cryptoTax: number;
	totalTax: number;
	stockExempt: boolean;
}

type FiscalCategory = 'stock' | 'fii' | 'crypto';
type PositionState = { qty: number; totalCost: number };

export interface FiscalAccumulatedLossSummary {
	stock: number;
	fii: number;
	crypto: number;
	total: number;
}

export interface FiscalTaxDriverSummary {
	symbol: string;
	category: 'stock' | 'fii' | 'crypto';
	operations: number;
	grossSales: number;
	realizedProfit: number;
	estimatedTax: number;
	taxRate: number;
	reason: string;
}

@Injectable()
export class FiscalService {
	constructor(private readonly averagePriceService: AveragePriceService) {}

	normalizeSellQuantity(
		requestedQuantity: number,
		currentQuantity: number
	): { effectiveQuantity: number; warning: string | null } {
		const requested = Number(requestedQuantity || 0);
		const current = Number(currentQuantity || 0);
		if (requested <= 0 || current <= 0) {
			return {
				effectiveQuantity: 0,
				warning: null,
			};
		}
		if (requested <= current) {
			return {
				effectiveQuantity: requested,
				warning: null,
			};
		}
		return {
			effectiveQuantity: current,
			warning: `Quantidade solicitada (${requested}) maior que posição atual (${current}). Simulação ajustada para a quantidade disponível.`,
		};
	}

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

	private getCategory(symbol: string, explicitType?: string): FiscalCategory {
		const type = (explicitType || '').toLowerCase();
		if (type === 'crypto') return 'crypto';
		if (type === 'fii' || /11$/.test(symbol.toUpperCase())) return 'fii';
		return 'stock';
	}

	getCategoryForAsset(symbol: string, explicitType?: string): FiscalCategory {
		return this.getCategory(symbol, explicitType);
	}

	calculateAccumulatedLosses(
		trades: Trade[],
		assetTypeBySymbol: Record<string, string> = {},
		year?: number
	): FiscalAccumulatedLossSummary {
		const sorted = [...trades]
			.filter((trade) =>
				typeof year === 'number' ? trade.date.getFullYear() <= year : true
			)
			.sort((a, b) => a.date.getTime() - b.date.getTime());

		const positionBySymbol = new Map<string, PositionState>();
		const cumulativeByCategory: Record<FiscalCategory, number> = {
			stock: 0,
			fii: 0,
			crypto: 0,
		};

		for (const trade of sorted) {
			const symbol = String(trade.assetSymbol || '').toUpperCase();
			if (!symbol) continue;
			const category = this.getCategory(symbol, assetTypeBySymbol[symbol]);
			const position = positionBySymbol.get(symbol) ?? { qty: 0, totalCost: 0 };
			const quantity = Number(trade.quantity || 0);
			const price = Number(trade.price || 0);
			const fees = Number(trade.fees || 0);

			if (trade.side === 'buy') {
				position.qty += quantity;
				position.totalCost += quantity * price + fees;
				positionBySymbol.set(symbol, position);
				continue;
			}

			const averagePrice =
				position.qty > 0 ? position.totalCost / position.qty : 0;
			const realizedPnl = (price - averagePrice) * quantity - fees;
			cumulativeByCategory[category] += realizedPnl;

			position.qty -= quantity;
			position.totalCost -= averagePrice * quantity;
			if (position.qty <= 0) {
				position.qty = 0;
				position.totalCost = 0;
			}
			positionBySymbol.set(symbol, position);
		}

		const stock =
			cumulativeByCategory.stock < 0 ? Math.abs(cumulativeByCategory.stock) : 0;
		const fii =
			cumulativeByCategory.fii < 0 ? Math.abs(cumulativeByCategory.fii) : 0;
		const crypto =
			cumulativeByCategory.crypto < 0
				? Math.abs(cumulativeByCategory.crypto)
				: 0;

		return {
			stock: this.round(stock),
			fii: this.round(fii),
			crypto: this.round(crypto),
			total: this.round(stock + fii + crypto),
		};
	}

	calculateMonthlyTaxSummary(
		trades: Trade[],
		assetTypeBySymbol: Record<string, string> = {}
	): MonthlyTaxSummary[] {
		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);

		const positionBySymbol = new Map<
			string,
			{ qty: number; totalCost: number }
		>();
		const monthAcc = new Map<
			string,
			{
				year: number;
				month: number;
				stockSales: number;
				stockProfit: number;
				fiiProfit: number;
				cryptoProfit: number;
			}
		>();

		for (const t of sorted) {
			const symbol = t.assetSymbol.toUpperCase();
			const fees = t.fees ?? 0;
			const pos = positionBySymbol.get(symbol) ?? { qty: 0, totalCost: 0 };
			const category = this.getCategory(symbol, assetTypeBySymbol[symbol]);

			if (t.side === 'buy') {
				pos.totalCost += t.quantity * t.price + fees;
				pos.qty += t.quantity;
				positionBySymbol.set(symbol, pos);
				continue;
			}

			const avg = pos.qty > 0 ? pos.totalCost / pos.qty : 0;
			const pnl = (t.price - avg) * t.quantity - fees;
			pos.qty -= t.quantity;
			pos.totalCost -= avg * t.quantity;
			if (pos.qty <= 0) {
				pos.qty = 0;
				pos.totalCost = 0;
			}
			positionBySymbol.set(symbol, pos);

			const year = t.date.getFullYear();
			const month = t.date.getMonth() + 1;
			const key = `${year}-${month}`;
			const acc = monthAcc.get(key) ?? {
				year,
				month,
				stockSales: 0,
				stockProfit: 0,
				fiiProfit: 0,
				cryptoProfit: 0,
			};

			if (category === 'stock') {
				acc.stockSales += t.price * t.quantity;
				acc.stockProfit += pnl;
			}
			if (category === 'fii') acc.fiiProfit += pnl;
			if (category === 'crypto') acc.cryptoProfit += pnl;

			monthAcc.set(key, acc);
		}

		let carryStock = 0;
		let carryFii = 0;
		let carryCrypto = 0;

		const months = Array.from(monthAcc.values()).sort((a, b) =>
			a.year !== b.year ? a.year - b.year : a.month - b.month
		);

		return months.map((m) => {
			const stockExempt = m.stockSales <= 20000;
			const stockBase = m.stockProfit + carryStock;
			const fiiBase = m.fiiProfit + carryFii;
			const cryptoBase = m.cryptoProfit + carryCrypto;

			const stockTaxableBase = stockExempt ? 0 : Math.max(stockBase, 0);
			const fiiTaxableBase = Math.max(fiiBase, 0);
			const cryptoTaxableBase = Math.max(cryptoBase, 0);

			const stockTax = stockTaxableBase * 0.15;
			const fiiTax = fiiTaxableBase * 0.2;
			const cryptoTax = cryptoTaxableBase * 0.15;

			carryStock = stockBase < 0 ? stockBase : 0;
			carryFii = fiiBase < 0 ? fiiBase : 0;
			carryCrypto = cryptoBase < 0 ? cryptoBase : 0;

			return {
				year: m.year,
				month: m.month,
				stockSales: m.stockSales,
				stockProfit: m.stockProfit,
				fiiProfit: m.fiiProfit,
				cryptoProfit: m.cryptoProfit,
				stockTax,
				fiiTax,
				cryptoTax,
				totalTax: stockTax + fiiTax + cryptoTax,
				stockExempt,
			};
		});
	}

	calculateTaxDrivers(
		trades: Trade[],
		assetTypeBySymbol: Record<string, string> = {}
	): FiscalTaxDriverSummary[] {
		const sorted = [...trades].sort(
			(a, b) => a.date.getTime() - b.date.getTime()
		);
		const positionBySymbol = new Map<string, PositionState>();

		const stockSalesByMonth = new Map<string, number>();
		for (const trade of sorted) {
			if (trade.side !== 'sell') continue;
			const symbol = String(trade.assetSymbol || '').toUpperCase();
			const category = this.getCategory(symbol, assetTypeBySymbol[symbol]);
			if (category !== 'stock') continue;
			const monthKey = this.toMonthKey(trade.date);
			const gross = Number(trade.quantity || 0) * Number(trade.price || 0);
			stockSalesByMonth.set(monthKey, (stockSalesByMonth.get(monthKey) || 0) + gross);
		}

		const grouped = new Map<string, FiscalTaxDriverSummary>();
		for (const trade of sorted) {
			const symbol = String(trade.assetSymbol || '').toUpperCase();
			if (!symbol) continue;
			const category = this.getCategory(symbol, assetTypeBySymbol[symbol]);
			const quantity = Number(trade.quantity || 0);
			const price = Number(trade.price || 0);
			const fees = Number(trade.fees || 0);
			const position = positionBySymbol.get(symbol) ?? { qty: 0, totalCost: 0 };

			if (trade.side === 'buy') {
				position.qty += quantity;
				position.totalCost += quantity * price + fees;
				positionBySymbol.set(symbol, position);
				continue;
			}

			const avgPrice = position.qty > 0 ? position.totalCost / position.qty : 0;
			const realizedPnl = (price - avgPrice) * quantity - fees;
			position.qty -= quantity;
			position.totalCost -= avgPrice * quantity;
			if (position.qty <= 0) {
				position.qty = 0;
				position.totalCost = 0;
			}
			positionBySymbol.set(symbol, position);

			const gross = quantity * price;
			const monthKey = this.toMonthKey(trade.date);
			const monthStockSales = stockSalesByMonth.get(monthKey) || 0;
			const isStockExempt = category === 'stock' && monthStockSales <= 20000;
			const taxRate = category === 'fii' ? 0.2 : 0.15;

			let estimatedTax = 0;
			let reason = 'Operação sem lucro tributável.';
			if (realizedPnl > 0) {
				if (isStockExempt) {
					reason =
						'Vendas mensais de ações abaixo do limite de isenção (R$ 20.000).';
				} else {
					estimatedTax = realizedPnl * taxRate;
					reason =
						category === 'stock'
							? 'Venda com lucro tributável em ações (mês acima de R$ 20.000).'
							: category === 'fii'
								? 'Venda com lucro tributável em FII (alíquota de 20%).'
								: 'Venda com lucro tributável (alíquota estimada de 15%).';
				}
			}

			const current = grouped.get(symbol) || {
				symbol,
				category,
				operations: 0,
				grossSales: 0,
				realizedProfit: 0,
				estimatedTax: 0,
				taxRate,
				reason,
			};

			current.operations += 1;
			current.grossSales += gross;
			current.realizedProfit += realizedPnl;
			current.estimatedTax += estimatedTax;
			if (estimatedTax > 0) {
				current.reason = reason;
				current.taxRate = taxRate;
			}
			grouped.set(symbol, current);
		}

		return Array.from(grouped.values())
			.map((item) => ({
				...item,
				grossSales: this.round(item.grossSales),
				realizedProfit: this.round(item.realizedProfit),
				estimatedTax: this.round(item.estimatedTax),
			}))
			.sort((a, b) => {
				if (b.estimatedTax !== a.estimatedTax) return b.estimatedTax - a.estimatedTax;
				return b.realizedProfit - a.realizedProfit;
			});
	}

	estimateSaleTax(params: {
		symbol: string;
		quantity: number;
		sellPrice: number;
		averagePrice: number;
		monthStockSales?: number;
		assetType?: string;
	}) {
		const category = this.getCategory(params.symbol, params.assetType);
		const gross = params.quantity * params.sellPrice;
		const pnl = (params.sellPrice - params.averagePrice) * params.quantity;
		const stockSalesMonth = (params.monthStockSales ?? 0) + gross;
		if (pnl <= 0) {
			return {
				category,
				gross,
				pnl,
				tax: 0,
				exempt: true,
				stockSalesMonth,
				stockExemptionLimit: 20000,
			};
		}

		if (category === 'stock' && stockSalesMonth <= 20000) {
			return {
				category,
				gross,
				pnl,
				tax: 0,
				exempt: true,
				stockSalesMonth,
				stockExemptionLimit: 20000,
			};
		}

		const rate = category === 'fii' ? 0.2 : 0.15;
		return {
			category,
			gross,
			pnl,
			tax: pnl * rate,
			exempt: false,
			stockSalesMonth,
			stockExemptionLimit: 20000,
		};
	}

	private round(value: number): number {
		return Math.round((Number(value) || 0) * 100) / 100;
	}

	private toMonthKey(date: Date): string {
		const year = date.getUTCFullYear();
		const month = date.getUTCMonth() + 1;
		return `${year}-${String(month).padStart(2, '0')}`;
	}
}
