import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
	FinancialIndicators,
	IDataProvider,
	PortfolioData,
	Position,
	StockData,
} from 'src/portfolio/interface/portfolio.interface';

@Injectable()
export class B3ApiAdapter implements IDataProvider {
	private readonly logger = new Logger(B3ApiAdapter.name);
	private client: AxiosInstance;

	constructor() {
		this.client = axios.create({
			baseURL: 'https://api.b3.com.br/v1',
			headers: {
				Authorization: `Bearer ${process.env.B3_API_KEY}`,
				'Content-Type': 'application/json',
			},
			timeout: 5000,
		});
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.client.get('/health');
			this.logger.log('B3 API connection validated');
			return true;
		} catch (error) {
			this.logger.error('B3 API validation failed:', error);
			return false;
		}
	}

	async getPositionsByCPF(cpf: string): Promise<Position[]> {
		try {
			const response = await this.client.get('/positions', {
				params: { cpf, format: 'json' },
			});

			return response.data.positions.map((item: any) => ({
				symbol: item.symbol,
				quantity: item.quantity,
				price: item.price,
				total: item.total_value,
			}));
		} catch (error) {
			this.logger.error(`Failed to fetch positions for CPF ${cpf}:`, error);
			throw new Error('B3 API request failed');
		}
	}

	async getIndicators(symbol: string): Promise<FinancialIndicators> {
		try {
			const response = await this.client.get(`/indicators/${symbol}`, {
				params: { format: 'json' },
			});

			return {
				valuation: response.data.valuation,
				profitability: response.data.profitability,
				dividend: response.data.dividend,
				efficiency: response.data.efficiency,
				profitabilityMetrics: response.data.profitabilityMetrics,
				growth: response.data.growth,
				lastUpdated: new Date(),
			};
		} catch (error) {
			this.logger.error(`Failed to fetch indicators for ${symbol}:`, error);
			throw new Error('B3 API indicators request failed');
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
			trends: {
				dividendYieldTrend:
					indicators.valuation.dividendYield > 3 ? 'up' : 'stable',
				priceToEarningsTrend:
					indicators.valuation.priceToEarnings < 20 ? 'down' : 'stable',
				profitabilityTrend:
					indicators.profitability.returnOnEquity > 10 ? 'up' : 'stable',
			},
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
}
