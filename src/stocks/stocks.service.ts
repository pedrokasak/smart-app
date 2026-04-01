import { Injectable, Logger } from '@nestjs/common';
import { BrapiAdapter } from './adapter/brapiDataApi';
import { TwelveDataAdapter } from './adapter/twelveDataApi';
import { StockRepository } from 'src/stocks/repositories/stock-repository';
import { FundamentusFallbackAdapter } from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { CvmOpenDataAdapter } from 'src/stocks/adapter/cvm-open-data.adapter';
import axios from 'axios';

@Injectable()
export class StockService implements StockRepository {
	private readonly logger = new Logger(StockService.name);
	private static readonly GLOBAL_QUOTE_CHAIN = [
		'twelve_data',
		'brapi',
		'b3_future',
	] as const;

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

	private getFundamentusText(
		fields: Record<string, string>,
		aliases: string[]
	): string | undefined {
		const normalizedEntries = new Map<string, string>();
		for (const [key, value] of Object.entries(fields || {})) {
			const normalizedKey = this.normalizeFundamentusKey(key);
			if (!normalizedKey) continue;
			normalizedEntries.set(normalizedKey, String(value || '').trim());
		}

		for (const alias of aliases) {
			const normalizedAlias = this.normalizeFundamentusKey(alias);
			const value = normalizedEntries.get(normalizedAlias);
			if (!value) continue;
			if (value === '-' || value === '--') continue;
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

		let fundamentusSnapshot: {
			numeric: Record<string, number>;
			text: Record<string, string>;
		} = { numeric: {}, text: {} };
		try {
			fundamentusSnapshot =
				await this.fundamentusFallback.getSnapshot(cleanSymbol);
		} catch (error) {
			this.logger.warn(
				`Fallback Fundamentus indisponivel para ${cleanSymbol}: ${error?.message || error}`
			);
		}
		const fundamentals = fundamentusSnapshot.numeric || {};
		const fundamentusText = fundamentusSnapshot.text || {};
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
		const assetsFromFundamentus = this.getFundamentusValue(fundamentals, [
			'ATIVO',
			'ATIVOS',
		]);
		const equityFromFundamentus = this.getFundamentusValue(fundamentals, [
			'PATRIM LIQ',
			'PATRIMONIO LIQUIDO',
			'PATRIM LIQUIDO',
		]);
		const debtFromFundamentus = this.getFundamentusValue(fundamentals, [
			'DIV BRUTA',
			'DIVIDA BRUTA',
			'DIV LIQ',
			'DIVIDA LIQUIDA',
		]);
		const revenueFromFundamentus = this.getFundamentusValue(fundamentals, [
			'RECEITA LIQUIDA',
			'RECEITA LIQ',
		]);
		const netIncomeFromFundamentus = this.getFundamentusValue(fundamentals, [
			'LUCRO LIQUIDO',
			'LUCRO LIQ',
		]);
		const marketCapFromFundamentus = this.getFundamentusValue(fundamentals, [
			'VALOR DE MERCADO',
		]);
		const companyNameFromFundamentus = this.getFundamentusText(
			fundamentusText,
			['EMPRESA', 'NOME']
		);
		const sectorFromFundamentus = this.getFundamentusText(fundamentusText, [
			'SETOR',
		]);
		const industryFromFundamentus = this.getFundamentusText(fundamentusText, [
			'SUBSETOR',
			'INDUSTRIA',
		]);
		const syntheticSummary =
			sectorFromFundamentus || industryFromFundamentus
				? `${companyNameFromFundamentus || cleanSymbol}: atuação em ${
						sectorFromFundamentus || 'setor não informado'
					}${industryFromFundamentus ? `, com foco em ${industryFromFundamentus}` : ''}.`
				: undefined;

		const fallbackMerged: Record<string, unknown> = {
			...stock,
			longName: stock.longName || companyNameFromFundamentus || stock.shortName,
			sector: stock.sector || sectorFromFundamentus,
			industry: stock.industry || industryFromFundamentus,
			longBusinessSummary: stock.longBusinessSummary || syntheticSummary,
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
			totalRevenue: this.withFallback(
				stock.totalRevenue,
				revenueFromFundamentus,
				{ zeroIsMissing: true }
			),
			netIncomeToCommon: this.withFallback(
				stock.netIncomeToCommon,
				netIncomeFromFundamentus,
				{ zeroIsMissing: true }
			),
			totalAssets: this.withFallback(stock.totalAssets, assetsFromFundamentus, {
				zeroIsMissing: true,
			}),
			totalStockholderEquity: this.withFallback(
				stock.totalStockholderEquity,
				equityFromFundamentus,
				{ zeroIsMissing: true }
			),
			totalDebt: this.withFallback(stock.totalDebt, debtFromFundamentus, {
				zeroIsMissing: true,
			}),
			marketCap: this.withFallback(stock.marketCap, marketCapFromFundamentus, {
				zeroIsMissing: true,
			}),
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
			const cvmHistory =
				await this.cvmAdapter.getComputedIndicatorsHistoryByCnpj(cnpj, [
					currentYear,
					currentYear - 1,
					currentYear - 2,
				]);
			const cvmData = cvmHistory[0] || null;
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
				if (
					this.isMissing(fallbackMerged.operatingCashflow, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.operatingCashflow = cvmData.operatingCashflow;
				}
				if (
					this.isMissing(fallbackMerged.investingCashflow, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.investingCashflow = cvmData.investingCashflow;
				}
				if (
					this.isMissing(fallbackMerged.financingCashflow, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.financingCashflow = cvmData.financingCashflow;
				}
				if (
					this.isMissing(fallbackMerged.depreciation, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.depreciation = cvmData.depreciation;
				}
				if (
					this.isMissing(fallbackMerged.freeCashflow, {
						zeroIsMissing: true,
					})
				) {
					fallbackMerged.freeCashflow = cvmData.freeCashflow;
				}
				fallbackMerged.financialHistory = cvmHistory.map((row) => ({
					year: row.referenceYear,
					revenue: row.revenue,
					netIncome: row.netIncome,
					totalAssets: row.totalAssets,
					shareholdersEquity: row.shareholdersEquity,
				}));
				fallbackMerged.cashflowHistory = cvmHistory.map((row) => ({
					year: row.referenceYear,
					operatingCashflow: row.operatingCashflow,
					investingCashflow: row.investingCashflow,
					financingCashflow: row.financingCashflow,
					depreciation: row.depreciation,
					freeCashflow: row.freeCashflow,
					netIncome: row.netIncome,
				}));
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
		const cleanSymbol = symbol.trim().toUpperCase();
		const startedAt = Date.now();

		try {
			const primaryResponse = await this.twelveData.getStockQuote(cleanSymbol);
			return this.normalizeGlobalQuoteResponse(
				primaryResponse,
				cleanSymbol,
				'twelve_data',
				[],
				startedAt
			);
		} catch (primaryError) {
			this.logger.warn(
				`Falha no provider primário (twelve_data) para ${cleanSymbol}: ${primaryError?.message || primaryError}`
			);
		}

		try {
			const fallbackResponse = await this.brapi.getStockQuote(cleanSymbol);
			return this.normalizeGlobalQuoteResponse(
				fallbackResponse,
				cleanSymbol,
				'brapi',
				['twelve_data'],
				startedAt
			);
		} catch (fallbackError) {
			this.logger.warn(
				`Falha no provider de fallback (brapi) para ${cleanSymbol}: ${fallbackError?.message || fallbackError}`
			);
		}

		return {
			results: [
				{
					symbol: cleanSymbol,
					unavailable: true,
					message: 'Quote indisponível no momento.',
				},
			],
			requestedAt: new Date().toISOString(),
			took: `${Date.now() - startedAt}ms`,
			source: 'unavailable',
			fallbackSources: StockService.GLOBAL_QUOTE_CHAIN.slice(0, 2),
			unavailableProviders: StockService.GLOBAL_QUOTE_CHAIN.slice(0, 2),
		};
	}

	private normalizeGlobalQuoteResponse(
		rawResponse: any,
		requestedSymbol: string,
		source: 'twelve_data' | 'brapi',
		fallbackSources: string[],
		startedAtMs: number
	): any {
		if (rawResponse && Array.isArray(rawResponse.results)) {
			return {
				...rawResponse,
				requestedAt:
					rawResponse.requestedAt || new Date(startedAtMs).toISOString(),
				took: rawResponse.took || `${Date.now() - startedAtMs}ms`,
				source,
				fallbackSources,
				results: rawResponse.results.map((result: Record<string, unknown>) => ({
					...result,
					symbol: String(result?.symbol || requestedSymbol).toUpperCase(),
				})),
			};
		}

		const normalizedResult =
			rawResponse && typeof rawResponse === 'object'
				? {
						...rawResponse,
						symbol: String(rawResponse.symbol || requestedSymbol).toUpperCase(),
					}
				: {
						symbol: requestedSymbol,
					};

		return {
			results: [normalizedResult],
			requestedAt: new Date(startedAtMs).toISOString(),
			took: `${Date.now() - startedAtMs}ms`,
			source,
			fallbackSources,
		};
	}

	async getLatestCdiRate(): Promise<{
		symbol: 'CDI';
		value: number | null;
		date: string | null;
		unit: 'daily_percent';
		source: 'BACEN_SGS_12';
	}> {
		const fallback = {
			symbol: 'CDI' as const,
			value: null,
			date: null,
			unit: 'daily_percent' as const,
			source: 'BACEN_SGS_12' as const,
		};

		try {
			const response = await axios.get(
				'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json',
				{
					timeout: 8000,
				}
			);

			const latest = Array.isArray(response.data) ? response.data[0] : null;
			if (!latest) return fallback;

			const numericValue = Number(String(latest.valor ?? '').replace(',', '.'));
			const rawDate = String(latest.data ?? '');
			const [day, month, year] = rawDate.split('/');
			const isoDate =
				day && month && year
					? new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString()
					: null;

			return {
				symbol: 'CDI',
				value: Number.isFinite(numericValue) ? numericValue : null,
				date: isoDate,
				unit: 'daily_percent',
				source: 'BACEN_SGS_12',
			};
		} catch (error) {
			this.logger.warn(
				`Falha ao buscar CDI no BACEN: ${error?.message || error}`
			);
			return fallback;
		}
	}

	async getLatestCdiRate(): Promise<{
		symbol: 'CDI';
		value: number | null;
		date: string | null;
		unit: 'daily_percent';
		source: 'BACEN_SGS_12';
	}> {
		const fallback = {
			symbol: 'CDI' as const,
			value: null,
			date: null,
			unit: 'daily_percent' as const,
			source: 'BACEN_SGS_12' as const,
		};

		try {
			const response = await axios.get(
				'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json',
				{
					timeout: 8000,
				}
			);

			const latest = Array.isArray(response.data) ? response.data[0] : null;
			if (!latest) return fallback;

			const numericValue = Number(String(latest.valor ?? '').replace(',', '.'));
			const rawDate = String(latest.data ?? '');
			const [day, month, year] = rawDate.split('/');
			const isoDate =
				day && month && year
					? new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString()
					: null;

			return {
				symbol: 'CDI',
				value: Number.isFinite(numericValue) ? numericValue : null,
				date: isoDate,
				unit: 'daily_percent',
				source: 'BACEN_SGS_12',
			};
		} catch (error) {
			this.logger.warn(
				`Falha ao buscar CDI no BACEN: ${error?.message || error}`
			);
			return fallback;
		}
	}
}
