export interface Position {
	symbol: string;
	quantity: number;
	price: number;
	total: number;
}

// Valuation Indicators
export interface ValuationIndicators {
	dividendYield: number; // D.Y %
	priceToEarnings: number; // P/L
	pegRatio: number; // PEG RATIO
	priceToBook: number; // P/VP
	evToEbitda: number; // EV/EBITDA
	evToEbit: number; // EV/EBIT
	ebitdaPerShare: number; // P/EBITDA
	earningsPerShare: number; // P/EBIT
	priceToSales: number; // VPA
	priceToAssets: number; // P/ATIVO
	liquidityProvider: number; // LPA
	priceToSalesAlt: number; // P/SR
	pricePerShareToEquity: number; // P/CAP. GIRO
	priceToCirculatingLiquidity: number; // P/ATIVO CIRC. LIQ.
}

// Profitability Indicators
export interface ProfitabilityIndicators {
	returnOnEquity: number; // ROE %
	returnOnAssets: number; // ROA %
	grossMarginEbitda: number; // M. EBITDA %
	grossMarginEbit: number; // M. EBIT %
	returnOnInvestedCapital: number; // ROIC %
	assetTurnover: number; // GIRO ATIVOS
}

// Dividend & Endowment Indicators
export interface DividendIndicators {
	dividendPayoutLiquidityToNetProfit: number; // DIV. LIQUIDA/PL %
	dividendPayoutLiquidityToEbitda: number; // DIV. LIQUIDA/EBITDA %
	dividendPayoutLiquidityToEbit: number; // DIV. LIQUIDA/EBIT %
	priceToAssetsRatio: number; // PL/ATIVOS %
	liabilitiesToAssets: number; // PASSIVOS/ATIVOS %
	currentLiquidity: number; // LIQ. CORRENTE
}

// Efficiency Indicators
export interface EfficiencyIndicators {
	grossProfitMargin: number; // M. BRUTA %
	ebitdaMargin: number; // M. EBITDA %
	ebitMargin: number; // M. EBIT %
	netLiquidityMargin: number; // M. LIQUIDA %
}

// Profitability Indicators (Alternative)
export interface ProfitabilityMetrics {
	roePercentage: number; // ROE %
	roaPercentage: number; // ROA %
	roicPercentage: number; // ROIC %
	giroAtivos: number; // GIRO ATIVOS
}

// Growth Indicators
export interface GrowthIndicators {
	growthRate5Years: number; // CAGR ULTIMOS 5 ANOS %
	growthRate3Years: number; // CAGR ULTIMOS 3 ANOS %
	revenueGrowth: number; // CRESCIMENTO RECEITA BRUTA %
}

// Complete Financial Indicators
export interface FinancialIndicators {
	valuation: ValuationIndicators;
	profitability: ProfitabilityIndicators;
	dividend: DividendIndicators;
	efficiency: EfficiencyIndicators;
	profitabilityMetrics: ProfitabilityMetrics;
	growth: GrowthIndicators;
	lastUpdated: Date;
}

// Complete Stock Data
export interface StockData extends Position {
	indicators: FinancialIndicators;
	trends: StockTrend;
}

// Trend Information
export interface StockTrend {
	dividendYieldTrend: 'up' | 'down' | 'stable';
	priceToEarningsTrend: 'up' | 'down' | 'stable';
	profitabilityTrend: 'up' | 'down' | 'stable';
}

// Portfolio Complete Data
export interface PortfolioData {
	cpf: string;
	positions: StockData[];
	totalValue: number;
	lastUpdated: Date;
}

export interface IDataProvider {
	getPositionsByCPF(cpf: string): Promise<Position[]>;
	getIndicators(symbol: string): Promise<FinancialIndicators>;
	getCompleteStockData(
		symbol: string,
		quantity: number,
		price: number,
		total: number
	): Promise<StockData>;
	getCompletePortfolioByCPF(cpf: string): Promise<PortfolioData>;
	validateConnection(): Promise<boolean>;
}
