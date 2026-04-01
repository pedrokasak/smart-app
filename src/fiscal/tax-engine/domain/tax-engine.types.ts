export type TaxAssetType =
	| 'stock'
	| 'fii'
	| 'crypto'
	| 'etf'
	| 'fund'
	| 'other';
export type TaxOperationSide = 'buy' | 'sell';
export type TaxResultClassification =
	| 'isento'
	| 'tributavel'
	| 'tributavel_com_compensacao';

export interface TaxOperationInput {
	symbol: string;
	assetType: TaxAssetType;
	side: TaxOperationSide;
	quantity: number;
	unitPrice: number;
	fees?: number;
	date?: Date | string;
}

export interface TaxPositionSnapshot {
	symbol: string;
	assetType: TaxAssetType;
	quantity: number;
	totalCost: number;
	averagePrice: number;
}

export interface TaxSaleRealization {
	symbol: string;
	assetType: TaxAssetType;
	date: string | null;
	sellQuantity: number;
	sellPrice: number;
	averagePriceAtSale: number;
	grossProceeds: number;
	costBasis: number;
	fees: number;
	realizedPnl: number;
	classification: TaxResultClassification;
	monthlyExemptionApplied: boolean;
	stockMonthlyGrossSales: number | null;
	compensationUsed: number;
	taxableBaseBeforeCompensation: number;
	taxableBaseAfterCompensation: number;
	remainingPosition: TaxPositionSnapshot;
}

export interface TaxEngineRulesConfig {
	stockMonthlyExemptionLimit?: number;
	includeExemptStockLossInCompensation?: boolean;
}

export interface TaxEngineEvaluationOutput {
	positions: TaxPositionSnapshot[];
	realizedSales: TaxSaleRealization[];
	aggregates: {
		realizedProfit: number;
		realizedLoss: number;
		netRealizedPnl: number;
	};
	lossCompensationBase: {
		accumulatedLossByAssetType: Record<TaxAssetType, number>;
		totalAccumulatedLoss: number;
	};
	rulesApplied: {
		stockMonthlyExemptionLimit: number;
		includeExemptStockLossInCompensation: boolean;
	};
}

export interface TaxSellSimulationInput {
	symbol: string;
	assetType: TaxAssetType;
	quantityToSell: number;
	sellPrice: number;
	fees?: number;
	accumulatedCompensableLoss?: number;
	stockMonthlyGrossSales?: number;
	rulesConfig?: TaxEngineRulesConfig;
	currentPosition: {
		quantity: number;
		totalCost: number;
	};
}

export interface TaxSellSimulationOutput {
	symbol: string;
	assetType: TaxAssetType;
	sellQuantity: number;
	averagePriceAtSale: number;
	realizedPnl: number;
	classification: TaxResultClassification;
	monthlyExemptionApplied: boolean;
	compensationUsed: number;
	taxableBaseAfterCompensation: number;
	remainingPosition: TaxPositionSnapshot;
	assumptions: {
		calculationMethod: 'weighted_average_cost';
	};
}

export interface TaxEstimateRateConfig {
	stock: number;
	fii: number;
	crypto: number;
	etf: number;
	fund: number;
	other: number;
}

export interface SellSimulationInput {
	symbol: string;
	assetType: TaxAssetType;
	quantityToSell: number;
	sellPrice: number;
	simulatedSellDate: Date | string;
	fees?: number;
	accumulatedCompensableLoss?: number;
	stockMonthlyGrossSales?: number;
	rulesConfig?: TaxEngineRulesConfig;
	taxRateConfig?: Partial<TaxEstimateRateConfig>;
	currentPosition: {
		quantity: number;
		totalCost: number;
	};
}

export interface SellSimulationOutput {
	symbol: string;
	assetType: TaxAssetType;
	simulatedSellDate: string | null;
	averagePrice: number;
	realizedPnl: number;
	estimatedTax: number;
	taxRateApplied: number;
	taxableBaseAfterCompensation: number;
	compensationUsed: number;
	classification: TaxResultClassification;
	monthlyExemptionApplied: boolean;
	remainingQuantity: number;
	remainingPosition: TaxPositionSnapshot;
	assumptions: {
		calculationMethod: 'weighted_average_cost';
	};
}
