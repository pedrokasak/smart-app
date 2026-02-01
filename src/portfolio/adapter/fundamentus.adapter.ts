import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import {
	IDataProvider,
	Position,
	FinancialIndicators,
	ValuationIndicators,
	ProfitabilityIndicators,
	DividendIndicators,
	EfficiencyIndicators,
	ProfitabilityMetrics,
	GrowthIndicators,
	StockData,
	PortfolioData,
	StockTrend,
} from 'src/portfolio/interface/portfolio.interface';

@Injectable()
export class PuppeteerDataAdapter implements IDataProvider {
	private readonly logger = new Logger(PuppeteerDataAdapter.name);
	private browser: puppeteer.Browser;

	async validateConnection(): Promise<boolean> {
		try {
			const browser = await puppeteer.launch({ headless: true });
			await browser.close();
			this.logger.log('Puppeteer connection validated');
			return true;
		} catch (error) {
			this.logger.error('Puppeteer validation failed:', error);
			return false;
		}
	}

	async getPositionsByCPF(cpf: string): Promise<Position[]> {
		throw new Error(`Method not implemented.${cpf}`);
	}

	async getIndicators(symbol: string): Promise<FinancialIndicators> {
		const browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		});

		try {
			const page = await browser.newPage();
			await page.setUserAgent(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
			);

			// Navigate to stock indicators page (example: Fundamentus)
			await page.goto(
				`https://www.fundamentus.com.br/detalhes.php?papel=${symbol}`,
				{
					waitUntil: 'domcontentloaded',
				}
			);

			const indicators = await page.evaluate(() => {
				// Parse Valuation Indicators
				const getIndicatorValue = (label: string): number => {
					const elements = Array.from(document.querySelectorAll('td'));
					const element = elements.find((el) =>
						el.textContent?.includes(label)
					);
					if (!element) return 0;

					const value = element.nextElementSibling?.textContent || '0';
					return parseFloat(value.replace('%', '').replace(',', '.')) || 0;
				};

				const valuation: ValuationIndicators = {
					dividendYield: getIndicatorValue('Div. Yield'),
					priceToEarnings: getIndicatorValue('P/L'),
					pegRatio: getIndicatorValue('PEG Ratio'),
					priceToBook: getIndicatorValue('P/VP'),
					evToEbitda: getIndicatorValue('EV/EBITDA'),
					evToEbit: getIndicatorValue('EV/EBIT'),
					ebitdaPerShare: getIndicatorValue('P/EBITDA'),
					earningsPerShare: getIndicatorValue('P/EBIT'),
					priceToSales: getIndicatorValue('P/SR'),
					priceToAssets: getIndicatorValue('P/Ativo'),
					liquidityProvider: getIndicatorValue('LPA'),
					priceToSalesAlt: getIndicatorValue('P/SR Alt'),
					pricePerShareToEquity: getIndicatorValue('P/Cap. Giro'),
					priceToCirculatingLiquidity: getIndicatorValue('P/Ativo Circ. Liq.'),
				};

				const profitability: ProfitabilityIndicators = {
					returnOnEquity: getIndicatorValue('ROE'),
					returnOnAssets: getIndicatorValue('ROA'),
					grossMarginEbitda: getIndicatorValue('M. EBITDA'),
					grossMarginEbit: getIndicatorValue('M. EBIT'),
					returnOnInvestedCapital: getIndicatorValue('ROIC'),
					assetTurnover: getIndicatorValue('Giro Ativos'),
				};

				const dividend: DividendIndicators = {
					dividendPayoutLiquidityToNetProfit: getIndicatorValue('Div. Liq./PL'),
					dividendPayoutLiquidityToEbitda:
						getIndicatorValue('Div. Liq./EBITDA'),
					dividendPayoutLiquidityToEbit: getIndicatorValue('Div. Liq./EBIT'),
					priceToAssetsRatio: getIndicatorValue('PL/Ativos'),
					liabilitiesToAssets: getIndicatorValue('Passivos/Ativos'),
					currentLiquidity: getIndicatorValue('Liq. Corrente'),
				};

				const efficiency: EfficiencyIndicators = {
					grossProfitMargin: getIndicatorValue('M. Bruta'),
					ebitdaMargin: getIndicatorValue('M. EBITDA'),
					ebitMargin: getIndicatorValue('M. EBIT'),
					netLiquidityMargin: getIndicatorValue('M. Liquida'),
				};

				const profitabilityMetrics: ProfitabilityMetrics = {
					roePercentage: getIndicatorValue('ROE %'),
					roaPercentage: getIndicatorValue('ROA %'),
					roicPercentage: getIndicatorValue('ROIC %'),
					giroAtivos: getIndicatorValue('Giro Ativos'),
				};

				const growth: GrowthIndicators = {
					growthRate5Years: getIndicatorValue('CAGR 5 Anos'),
					growthRate3Years: getIndicatorValue('CAGR 3 Anos'),
					revenueGrowth: getIndicatorValue('Crescimento Receita'),
				};

				return {
					valuation,
					profitability,
					dividend,
					efficiency,
					profitabilityMetrics,
					growth,
				};
			});

			return {
				...indicators,
				lastUpdated: new Date(),
			};
		} finally {
			await browser.close();
		}
	}

	async getCompleteStockData(
		symbol: string,
		quantity: number,
		price: number,
		total: number
	): Promise<StockData> {
		const indicators = await this.getIndicators(symbol);

		return {
			symbol,
			quantity,
			price,
			total,
			indicators,
			trends: this.calculateTrends(indicators) as StockTrend,
		};
	}

	async getCompletePortfolioByCPF(cpf: string): Promise<PortfolioData> {
		const positions = await this.getPositionsByCPF(cpf);

		const stockDataArray = await Promise.all(
			positions.map((pos) =>
				this.getCompleteStockData(
					pos.symbol,
					pos.quantity,
					pos.price,
					pos.total
				)
			)
		);

		const totalValue = positions.reduce((sum, pos) => sum + pos.total, 0);

		return {
			cpf,
			positions: stockDataArray,
			totalValue,
			lastUpdated: new Date(),
		};
	}

	private calculateTrends(indicators: FinancialIndicators) {
		return {
			dividendYieldTrend:
				indicators.valuation.dividendYield > 3 ? 'up' : 'stable',
			priceToEarningsTrend:
				indicators.valuation.priceToEarnings < 20 ? 'down' : 'stable',
			profitabilityTrend:
				indicators.profitability.returnOnEquity > 10 ? 'up' : 'stable',
		};
	}
}
