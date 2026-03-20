import { Injectable } from '@nestjs/common';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { StockRepository } from 'src/stocks/repositories/stock-repository';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';

@Injectable()
export class StockService implements StockRepository {
	constructor(
		private readonly brapi: BrapiAdapter,
		private readonly twelveData: TwelveDataAdapter,
		private readonly fundamentusFallback: FundamentusFallbackAdapter,
		private readonly cvmAdapter: CvmOpenDataAdapter
	) {}

	async getAllNational(search = '', limit = 100, page = 1, sortBy = 'name') {
		return this.brapi.listAllStocks(search, sortBy, 'asc', limit, page);
	}

	async getNationalQuote(
		symbol: string,
		options?: {
			range?: string;
			interval?: string;
			fundamental?: boolean;
			dividends?: boolean;
		}
	) {
		const cleanSymbol = symbol.trim().toUpperCase();
		const response = await this.brapi.getStockQuote(cleanSymbol, options);
		const stock = response?.results?.[0];
		if (!stock) return response;

		const restricted = stock.restrictedData || [];
		const isMissing = (value: unknown) =>
			value === null || value === undefined || Number.isNaN(value as number);
		const shouldFallback =
			restricted.includes('fundamental') ||
			isMissing(stock.priceEarnings) ||
			isMissing(stock.priceToBook) ||
			isMissing(stock.returnOnEquity) ||
			isMissing(stock.netMargin);

		if (!shouldFallback) return response;

		const fundamentals = await this.fundamentusFallback.getIndicators(cleanSymbol);

		const pick = (...keys: string[]) => {
			for (const key of keys) {
				const value = fundamentals[key];
				if (typeof value === 'number' && Number.isFinite(value)) return value;
			}
			return 0;
		};

		const fallbackMerged = {
			...stock,
			priceEarnings:
				stock.priceEarnings ?? (isMissing(stock.priceEarnings) ? pick('P/L') : 0),
			priceToBook:
				stock.priceToBook ?? (isMissing(stock.priceToBook) ? pick('P/VP') : 0),
			enterpriseValueEbitda:
				stock.enterpriseValueEbitda ??
				(isMissing(stock.enterpriseValueEbitda) ? pick('EV/EBITDA') : 0),
			returnOnEquity:
				stock.returnOnEquity ??
				(pick('ROE') > 1 ? pick('ROE') / 100 : pick('ROE')),
			netMargin:
				stock.netMargin ??
				(pick('MARG LIQ') > 1 ? pick('MARG LIQ') / 100 : pick('MARG LIQ')),
			dividendYield:
				stock.dividendYield ??
				(pick('DIV YIELD') > 1 ? pick('DIV YIELD') / 100 : pick('DIV YIELD')),
			fallbackSources: [
				...(Array.isArray(stock.fallbackSources) ? stock.fallbackSources : []),
				'fundamentus',
			],
		};

		// Complementa com CVM Open Data quando houver CNPJ e lacunas financeiras.
		const cnpj = String(stock.cnpj || '');
		const needsCvm =
			!!cnpj &&
			(isMissing(fallbackMerged.totalRevenue) ||
				isMissing(fallbackMerged.netIncomeToCommon) ||
				isMissing(fallbackMerged.totalAssets) ||
				isMissing(fallbackMerged.totalStockholderEquity) ||
				isMissing(fallbackMerged.returnOnEquity) ||
				isMissing(fallbackMerged.netMargin));
		if (needsCvm) {
			const currentYear = new Date().getFullYear();
			const cvmData =
				(await this.cvmAdapter.getComputedIndicatorsByCnpj(cnpj, currentYear)) ||
				(await this.cvmAdapter.getComputedIndicatorsByCnpj(cnpj, currentYear - 1));
			if (cvmData) {
				if (isMissing(fallbackMerged.totalRevenue)) {
					fallbackMerged.totalRevenue = cvmData.revenue;
				}
				if (isMissing(fallbackMerged.netIncomeToCommon)) {
					fallbackMerged.netIncomeToCommon = cvmData.netIncome;
				}
				if (isMissing(fallbackMerged.totalAssets)) {
					fallbackMerged.totalAssets = cvmData.totalAssets;
				}
				if (isMissing(fallbackMerged.totalStockholderEquity)) {
					fallbackMerged.totalStockholderEquity = cvmData.shareholdersEquity;
				}
				if (isMissing(fallbackMerged.returnOnEquity)) {
					fallbackMerged.returnOnEquity = cvmData.roe;
				}
				if (isMissing(fallbackMerged.netMargin)) {
					fallbackMerged.netMargin = cvmData.netMargin;
				}
				fallbackMerged.fallbackSources = [
					...(Array.isArray(fallbackMerged.fallbackSources)
						? fallbackMerged.fallbackSources
						: []),
					'cvm_open_data',
				];
			}
		}

		return {
			...response,
			results: [fallbackMerged, ...(response.results || []).slice(1)],
		};
	}

	async getStockQuoteGlobal(symbol: string): Promise<any> {
		console.log('Fetching global stock quote for:', symbol);
		return this.twelveData.getStockQuote(symbol);
	}
}
