import {
	TaxAssetType,
	TaxEngineEvaluationOutput,
	TaxOperationInput,
	TaxPositionSnapshot,
	TaxEngineRulesConfig,
	TaxSaleRealization,
	TaxSellSimulationInput,
	TaxSellSimulationOutput,
} from 'src/fiscal/tax-engine/domain/tax-engine.types';

interface MutablePositionState {
	symbol: string;
	assetType: TaxAssetType;
	quantity: number;
	totalCost: number;
}

const DEFAULT_STOCK_MONTHLY_EXEMPTION_LIMIT = 20000;

export class TaxEngineCalculator {
	evaluateOperations(
		operations: TaxOperationInput[],
		rulesConfig?: TaxEngineRulesConfig
	): TaxEngineEvaluationOutput {
		const positions = new Map<string, MutablePositionState>();
		const realizedSales: TaxSaleRealization[] = [];
		const lossState = this.createEmptyLossState();
		const stockMonthlyGrossSales = new Map<string, number>();
		const stockMonthlyExemptionLimit = this.safeMoney(
			rulesConfig?.stockMonthlyExemptionLimit ??
				DEFAULT_STOCK_MONTHLY_EXEMPTION_LIMIT
		);
		const includeExemptStockLossInCompensation = Boolean(
			rulesConfig?.includeExemptStockLossInCompensation
		);

		const sortedOperations = [...operations].sort((a, b) => {
			const aTime = this.toTimestamp(a.date);
			const bTime = this.toTimestamp(b.date);
			if (aTime === bTime) return 0;
			return aTime - bTime;
		});
		this.computeStockMonthlyGrossSales(sortedOperations, stockMonthlyGrossSales);

		for (const operation of sortedOperations) {
			this.validateOperation(operation);

			const key = this.buildPositionKey(operation.symbol, operation.assetType);
			const position =
				positions.get(key) ||
				({
					symbol: this.normalizeSymbol(operation.symbol),
					assetType: operation.assetType,
					quantity: 0,
					totalCost: 0,
				} satisfies MutablePositionState);

			const quantity = Number(operation.quantity);
			const unitPrice = Number(operation.unitPrice);
			const fees = this.safeMoney(operation.fees || 0);

			if (operation.side === 'buy') {
				position.quantity += quantity;
				position.totalCost += quantity * unitPrice + fees;
				positions.set(key, position);
				continue;
			}

			if (quantity > position.quantity) {
				throw new Error(
					`Invalid sell operation for ${position.symbol}: quantity exceeds current position`
				);
			}

			const averagePrice = this.computeAveragePrice(position);
			const grossProceeds = quantity * unitPrice;
			const costBasis = quantity * averagePrice;
			const realizedPnl = grossProceeds - costBasis - fees;
			const monthKey = this.toMonthKey(operation.date);
			const monthlyGrossSales =
				operation.assetType === 'stock'
					? this.safeMoney(stockMonthlyGrossSales.get(monthKey) || 0)
					: null;
			const monthlyExemptionApplied =
				operation.assetType === 'stock' &&
				monthlyGrossSales !== null &&
				monthlyGrossSales <= stockMonthlyExemptionLimit;
			const taxableBaseBeforeCompensation =
				realizedPnl > 0 && !monthlyExemptionApplied ? realizedPnl : 0;
			let compensationUsed = 0;
			if (taxableBaseBeforeCompensation > 0) {
				const availableLoss = lossState[operation.assetType];
				compensationUsed = Math.min(availableLoss, taxableBaseBeforeCompensation);
				lossState[operation.assetType] = this.safeMoney(
					availableLoss - compensationUsed
				);
			}
			const taxableBaseAfterCompensation = this.safeMoney(
				taxableBaseBeforeCompensation - compensationUsed
			);
			const classification = this.resolveClassification({
				monthlyExemptionApplied,
				taxableBaseBeforeCompensation: this.safeMoney(
					taxableBaseBeforeCompensation
				),
				compensationUsed: this.safeMoney(compensationUsed),
			});

			position.quantity -= quantity;
			position.totalCost -= costBasis;
			if (position.quantity <= 0) {
				position.quantity = 0;
				position.totalCost = 0;
			}
			positions.set(key, position);

			realizedSales.push({
				symbol: position.symbol,
				assetType: position.assetType,
				date: this.toIsoDate(operation.date),
				sellQuantity: quantity,
				sellPrice: unitPrice,
				averagePriceAtSale: this.safeMoney(averagePrice),
				grossProceeds: this.safeMoney(grossProceeds),
				costBasis: this.safeMoney(costBasis),
				fees,
				realizedPnl: this.safeMoney(realizedPnl),
				classification,
				monthlyExemptionApplied,
				stockMonthlyGrossSales: monthlyGrossSales,
				compensationUsed: this.safeMoney(compensationUsed),
				taxableBaseBeforeCompensation: this.safeMoney(
					taxableBaseBeforeCompensation
				),
				taxableBaseAfterCompensation,
				remainingPosition: this.toPositionSnapshot(position),
			});

			if (realizedPnl < 0) {
				const shouldAccumulateExemptStockLoss =
					operation.assetType === 'stock'
						? includeExemptStockLossInCompensation || !monthlyExemptionApplied
						: true;
				if (shouldAccumulateExemptStockLoss) {
					lossState[operation.assetType] = this.safeMoney(
						lossState[operation.assetType] + Math.abs(realizedPnl)
					);
				}
			}
		}

		const snapshots = Array.from(positions.values())
			.filter((position) => position.quantity > 0)
			.map((position) => this.toPositionSnapshot(position))
			.sort((a, b) => a.symbol.localeCompare(b.symbol));

		const aggregates = this.computeAggregates(realizedSales);
		const lossCompensationBase = this.computeLossCompensationBase(lossState);

		return {
			positions: snapshots,
			realizedSales,
			aggregates,
			lossCompensationBase,
			rulesApplied: {
				stockMonthlyExemptionLimit,
				includeExemptStockLossInCompensation,
			},
		};
	}

	simulateSell(input: TaxSellSimulationInput): TaxSellSimulationOutput {
		const symbol = this.normalizeSymbol(input.symbol);
		const quantityToSell = Number(input.quantityToSell || 0);
		const sellPrice = Number(input.sellPrice || 0);
		const fees = this.safeMoney(input.fees || 0);
		const currentQuantity = Number(input.currentPosition?.quantity || 0);
		const currentTotalCost = this.safeMoney(input.currentPosition?.totalCost || 0);
		const stockMonthlyExemptionLimit = this.safeMoney(
			input.rulesConfig?.stockMonthlyExemptionLimit ??
				DEFAULT_STOCK_MONTHLY_EXEMPTION_LIMIT
		);
		const monthlyGrossSalesProjected = this.safeMoney(
			input.stockMonthlyGrossSales || quantityToSell * sellPrice
		);
		const monthlyExemptionApplied =
			input.assetType === 'stock' &&
			monthlyGrossSalesProjected <= stockMonthlyExemptionLimit;

		if (quantityToSell <= 0 || sellPrice <= 0) {
			throw new Error('Invalid sell simulation: quantity and price must be greater than zero');
		}
		if (quantityToSell > currentQuantity) {
			throw new Error('Invalid sell simulation: quantity exceeds current position');
		}

		const averagePriceAtSale =
			currentQuantity > 0 ? currentTotalCost / currentQuantity : 0;
		const grossProceeds = quantityToSell * sellPrice;
		const costBasis = quantityToSell * averagePriceAtSale;
		const realizedPnl = grossProceeds - costBasis - fees;
		const taxableBaseBeforeCompensation =
			realizedPnl > 0 && !monthlyExemptionApplied ? realizedPnl : 0;
		const availableLoss = this.safeMoney(input.accumulatedCompensableLoss || 0);
		const compensationUsed = Math.min(
			availableLoss,
			Math.max(taxableBaseBeforeCompensation, 0)
		);
		const taxableBaseAfterCompensation = this.safeMoney(
			taxableBaseBeforeCompensation - compensationUsed
		);
		const classification = this.resolveClassification({
			monthlyExemptionApplied,
			taxableBaseBeforeCompensation: this.safeMoney(
				taxableBaseBeforeCompensation
			),
			compensationUsed: this.safeMoney(compensationUsed),
		});

		const remainingQuantity = currentQuantity - quantityToSell;
		const remainingTotalCost = Math.max(currentTotalCost - costBasis, 0);
		const remainingPosition: TaxPositionSnapshot = {
			symbol,
			assetType: input.assetType,
			quantity: remainingQuantity,
			totalCost: this.safeMoney(remainingQuantity <= 0 ? 0 : remainingTotalCost),
			averagePrice:
				remainingQuantity <= 0
					? 0
					: this.safeMoney(remainingTotalCost / remainingQuantity),
		};

		return {
			symbol,
			assetType: input.assetType,
			sellQuantity: quantityToSell,
			averagePriceAtSale: this.safeMoney(averagePriceAtSale),
			realizedPnl: this.safeMoney(realizedPnl),
			classification,
			monthlyExemptionApplied,
			compensationUsed: this.safeMoney(compensationUsed),
			taxableBaseAfterCompensation,
			remainingPosition,
			assumptions: {
				calculationMethod: 'weighted_average_cost',
			},
		};
	}

	calculateAveragePrice(position: {
		quantity: number;
		totalCost: number;
	}): number {
		const quantity = Number(position.quantity || 0);
		if (quantity <= 0) return 0;
		return this.safeMoney(Number(position.totalCost || 0) / quantity);
	}

	private computeAggregates(realizedSales: TaxSaleRealization[]) {
		let realizedProfit = 0;
		let realizedLoss = 0;

		for (const sale of realizedSales) {
			if (sale.realizedPnl >= 0) {
				realizedProfit += sale.realizedPnl;
			} else {
				realizedLoss += Math.abs(sale.realizedPnl);
			}
		}

		return {
			realizedProfit: this.safeMoney(realizedProfit),
			realizedLoss: this.safeMoney(realizedLoss),
			netRealizedPnl: this.safeMoney(realizedProfit - realizedLoss),
		};
	}

	private computeLossCompensationBase(
		lossState: Record<TaxAssetType, number>
	) {
		const accumulatedLossByAssetType = this.createEmptyLossState();
		for (const assetType of Object.keys(accumulatedLossByAssetType) as TaxAssetType[]) {
			accumulatedLossByAssetType[assetType] = this.safeMoney(lossState[assetType]);
		}
		const totalAccumulatedLoss = this.safeMoney(
			Object.values(accumulatedLossByAssetType).reduce(
				(sum, value) => sum + value,
				0
			)
		);

		return {
			accumulatedLossByAssetType,
			totalAccumulatedLoss,
		};
	}

	private toPositionSnapshot(position: MutablePositionState): TaxPositionSnapshot {
		return {
			symbol: position.symbol,
			assetType: position.assetType,
			quantity: position.quantity,
			totalCost: this.safeMoney(position.totalCost),
			averagePrice: this.computeAveragePrice(position),
		};
	}

	private computeAveragePrice(position: MutablePositionState): number {
		if (position.quantity <= 0) {
			return 0;
		}
		return position.totalCost / position.quantity;
	}

	private validateOperation(operation: TaxOperationInput) {
		if (!operation.symbol || !operation.assetType || !operation.side) {
			throw new Error('Invalid operation: symbol, assetType and side are required');
		}
		if (Number(operation.quantity || 0) <= 0 || Number(operation.unitPrice || 0) < 0) {
			throw new Error('Invalid operation: quantity and unitPrice must be valid numbers');
		}
	}

	private computeStockMonthlyGrossSales(
		operations: TaxOperationInput[],
		output: Map<string, number>
	) {
		for (const operation of operations) {
			if (operation.side !== 'sell' || operation.assetType !== 'stock') continue;
			const monthKey = this.toMonthKey(operation.date);
			const gross = this.safeMoney(
				Number(operation.quantity || 0) * Number(operation.unitPrice || 0)
			);
			output.set(monthKey, this.safeMoney((output.get(monthKey) || 0) + gross));
		}
	}

	private resolveClassification(params: {
		monthlyExemptionApplied: boolean;
		taxableBaseBeforeCompensation: number;
		compensationUsed: number;
	}) {
		if (params.monthlyExemptionApplied) {
			return 'isento' as const;
		}
		if (params.taxableBaseBeforeCompensation > 0 && params.compensationUsed > 0) {
			return 'tributavel_com_compensacao' as const;
		}
		return 'tributavel' as const;
	}

	private buildPositionKey(symbol: string, assetType: TaxAssetType): string {
		return `${this.normalizeSymbol(symbol)}::${assetType}`;
	}

	private normalizeSymbol(symbol: string): string {
		return String(symbol || '').trim().toUpperCase();
	}

	private toIsoDate(value?: Date | string): string | null {
		if (!value) return null;
		const parsed = new Date(value);
		if (!Number.isFinite(parsed.getTime())) return null;
		return parsed.toISOString();
	}

	private toTimestamp(value?: Date | string): number {
		if (!value) return 0;
		const parsed = new Date(value);
		const timestamp = parsed.getTime();
		if (!Number.isFinite(timestamp)) return 0;
		return timestamp;
	}

	private toMonthKey(value?: Date | string): string {
		const parsed = value ? new Date(value) : new Date(0);
		if (!Number.isFinite(parsed.getTime())) {
			return '1970-01';
		}
		const year = parsed.getUTCFullYear();
		const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
		return `${year}-${month}`;
	}

	private createEmptyLossState(): Record<TaxAssetType, number> {
		return {
			stock: 0,
			fii: 0,
			crypto: 0,
			etf: 0,
			fund: 0,
			other: 0,
		};
	}

	private safeMoney(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Number(value.toFixed(2));
	}
}
