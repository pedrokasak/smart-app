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

	private isMissing(
		value: unknown,
		options?: { zeroIsMissing?: boolean }
	): boolean {
		if (value === null || value === undefined) return true;
		if (typeof value !== 'number') return false;
		if (Number.isNaN(value)) return true;
		return options?.zeroIsMissing ? value === 0 : false;
	}

	private normalizeFundamentusKey(value: string): string {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Z0-9]/gi, '')
			.toUpperCase();
	}

	private getFundamentusValue(
		fundamentals: Record<string, number>,
		aliases: string[],
		options?: { treatAsPercent?: boolean }
	): number | undefined {
		const normalizedEntries = new Map<string, number>();
		for (const [key, value] of Object.entries(fundamentals || {})) {
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			normalizedEntries.set(this.normalizeFundamentusKey(key), value);
		}

		for (const alias of aliases) {
			const normalizedAlias = this.normalizeFundamentusKey(alias);
			const value = normalizedEntries.get(normalizedAlias);
			if (value === undefined) continue;
			if (this.isMissing(value, { zeroIsMissing: true })) continue;
			if (options?.treatAsPercent && value > 1) return value / 100;
			return value;
		}
		return undefined;
	}

	private withFallback(
		currentValue: unknown,
		fallbackValue: number | undefined,
		options?: { zeroIsMissing?: boolean }
	): unknown {
		return this.isMissing(currentValue, options)
			? (fallbackValue ?? currentValue)
			: currentValue;
	}

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
		const shouldFallback =
			restricted.includes('fundamental') ||
			this.isMissing(stock.priceEarnings, { zeroIsMissing: true }) ||
			this.isMissing(stock.priceToBook, { zeroIsMissing: true }) ||
			this.isMissing(stock.returnOnEquity, { zeroIsMissing: true }) ||
			this.isMissing(stock.netMargin, { zeroIsMissing: true }) ||
			this.isMissing(stock.enterpriseValueEbitda, { zeroIsMissing: true }) ||
			this.isMissing(stock.dividendYield, { zeroIsMissing: true });

		if (!shouldFallback) return response;

		const fundamentals =
			await this.fundamentusFallback.getIndicators(cleanSymbol);
		const peFromFundamentus = this.getFundamentusValue(fundamentals, ['P/L']);
		const pbFromFundamentus = this.getFundamentusValue(fundamentals, [
			'P/VP',
			'PVP',
		]);
		const evEbitdaFromFundamentus = this.getFundamentusValue(fundamentals, [
			'EV/EBITDA',
		]);
		const roeFromFundamentus = this.getFundamentusValue(
			fundamentals,
			['ROE', 'ROE %'],
			{ treatAsPercent: true }
		);
		const netMarginFromFundamentus = this.getFundamentusValue(
			fundamentals,
			['MARG LIQ', 'MARG. LIQUIDA', 'MARGEM LIQUIDA', 'M. LIQUIDA', 'M. LIQ'],
			{ treatAsPercent: true }
		);
		const dividendYieldFromFundamentus = this.getFundamentusValue(
			fundamentals,
			['DIV YIELD', 'DIV. YIELD', 'DY'],
			{ treatAsPercent: true }
		);
		const roicFromFundamentus = this.getFundamentusValue(
			fundamentals,
			['ROIC', 'ROIC %'],
			{ treatAsPercent: true }
		);

		const fallbackMerged: Record<string, unknown> = {
			...stock,
			priceEarnings: this.withFallback(stock.priceEarnings, peFromFundamentus, {
				zeroIsMissing: true,
			}),
			priceToBook: this.withFallback(stock.priceToBook, pbFromFundamentus, {
				zeroIsMissing: true,
			}),
			enterpriseValueEbitda: this.withFallback(
				stock.enterpriseValueEbitda,
				evEbitdaFromFundamentus,
				{ zeroIsMissing: true }
			),
			returnOnEquity: this.withFallback(
				stock.returnOnEquity,
				roeFromFundamentus,
				{
					zeroIsMissing: true,
				}
			),
			returnOnInvestedCapital: this.withFallback(
				stock.returnOnInvestedCapital,
				roicFromFundamentus,
				{ zeroIsMissing: true }
			),
			netMargin: this.withFallback(stock.netMargin, netMarginFromFundamentus, {
				zeroIsMissing: true,
			}),
			dividendYield: this.withFallback(
				stock.dividendYield,
				dividendYieldFromFundamentus,
				{ zeroIsMissing: true }
			),
			fallbackSources: [
				...(Array.isArray(stock.fallbackSources) ? stock.fallbackSources : []),
				'fundamentus',
			],
		};

		// Complementa com CVM Open Data quando houver CNPJ e lacunas financeiras.
		const cnpj = String(stock.cnpj || '');
		const needsCvm =
			!!cnpj &&
			(this.isMissing(fallbackMerged.totalRevenue, { zeroIsMissing: true }) ||
				this.isMissing(fallbackMerged.netIncomeToCommon, {
					zeroIsMissing: true,
				}) ||
				this.isMissing(fallbackMerged.totalAssets, { zeroIsMissing: true }) ||
				this.isMissing(fallbackMerged.totalStockholderEquity, {
					zeroIsMissing: true,
				}) ||
				this.isMissing(fallbackMerged.returnOnEquity, {
					zeroIsMissing: true,
				}) ||
				this.isMissing(fallbackMerged.netMargin, { zeroIsMissing: true }));
		if (needsCvm) {
			const currentYear = new Date().getFullYear();
			const cvmData =
				(await this.cvmAdapter.getComputedIndicatorsByCnpj(
					cnpj,
					currentYear
				)) ||
				(await this.cvmAdapter.getComputedIndicatorsByCnpj(
					cnpj,
					currentYear - 1
				));
			if (cvmData) {
				if (
					this.isMissing(fallbackMerged.totalRevenue, { zeroIsMissing: true })
				) {
					fallbackMerged.totalRevenue = cvmData.revenue;
				}
				if (
					this.isMissing(fallbackMerged.netIncomeToCommon, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.netIncomeToCommon = cvmData.netIncome;
				}
				if (
					this.isMissing(fallbackMerged.totalAssets, { zeroIsMissing: true })
				) {
					fallbackMerged.totalAssets = cvmData.totalAssets;
				}
				if (
					this.isMissing(fallbackMerged.totalStockholderEquity, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.totalStockholderEquity = cvmData.shareholdersEquity;
				}
				if (
					this.isMissing(fallbackMerged.returnOnEquity, { zeroIsMissing: true })
				) {
					fallbackMerged.returnOnEquity = cvmData.roe;
				}
				if (this.isMissing(fallbackMerged.netMargin, { zeroIsMissing: true })) {
					fallbackMerged.netMargin = cvmData.netMargin;
				}
				fallbackMerged.fallbackSources = [
					...(Array.isArray(fallbackMerged.fallbackSources)
						? (fallbackMerged.fallbackSources as string[])
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
