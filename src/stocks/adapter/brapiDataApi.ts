import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { brapiApiKey } from 'src/env';
import { StockApiAdapter } from './stockDataApi';
import { Injectable } from '@nestjs/common/decorators';

@Injectable()
export class BrapiAdapter implements StockApiAdapter {
	private readonly baseUrl = 'https://brapi.dev/api';

	constructor(private readonly httpService: HttpService) {}

	/**
	 * Busca cotações de uma ou mais ações.
	 * @param symbols String com tickers separados por vírgula, ex: "PETR4,VALE3"
	 * @param options Opções extras: range, interval, fundamental, dividends
	 */
	async getStockQuote(
		symbols: string,
		options?: {
			range?: string;
			interval?: string;
			fundamental?: boolean;
			dividends?: boolean;
		}
	): Promise<any> {
		const apiKey = brapiApiKey;
		if (!apiKey) throw new Error('BRAPI_API_KEY não definida');

		const restricted: string[] = [];
		let currentFundamental = options?.fundamental;
		let currentDividends = options?.dividends;

		const makeRequest = async (fund: boolean, div: boolean) => {
			const params = new URLSearchParams();
			params.append('token', apiKey);
			if (options?.range) params.append('range', options.range);
			if (options?.interval) params.append('interval', options.interval);
			if (fund) params.append('fundamental', 'true');
			if (div) params.append('dividends', 'true');

			const url = `${this.baseUrl}/quote/${symbols}?${params.toString()}`;
			return firstValueFrom(
				this.httpService.get(url, {
					headers: {
						'User-Agent': 'SmartFolio App',
						'Content-Type': 'application/json',
					},
				})
			);
		};

		try {
			const response = await makeRequest(!!currentFundamental, !!currentDividends);
			return response.data;
		} catch (error) {
			const errorData = error?.response?.data;
			if (errorData?.code === 'FEATURE_NOT_AVAILABLE' || errorData?.error) {
				const msg = errorData.message || '';
				console.warn('Brapi restriction detected:', msg);

				if (currentDividends && (msg.includes('dividend') || msg.includes('dividendo'))) {
					restricted.push('dividends');
					currentDividends = false;
				} else if (currentFundamental && (msg.includes('fundamental') || msg.includes('indicadores'))) {
					restricted.push('fundamental');
					currentFundamental = false;
				} else {
					// If we can't identify or it's both, try disabling dividends first then fundamental
					if (currentDividends) {
						restricted.push('dividends');
						currentDividends = false;
					} else if (currentFundamental) {
						restricted.push('fundamental');
						currentFundamental = false;
					} else {
						throw error; // Not something we can fix by stripping params
					}
				}

				try {
					const secondTry = await makeRequest(!!currentFundamental, !!currentDividends);
					if (secondTry.data.results?.[0]) {
						secondTry.data.results[0].restrictedData = restricted;
					}
					return secondTry.data;
				} catch (retryError) {
					// Last resort: try without both if it failed again
					if (currentFundamental || currentDividends) {
						const lastTry = await makeRequest(false, false);
						if (lastTry.data.results?.[0]) {
							lastTry.data.results[0].restrictedData = [
								...(currentFundamental ? ['fundamental'] : []),
								...(currentDividends ? ['dividends'] : []),
								...restricted,
							];
						}
						return lastTry.data;
					}
					throw retryError;
				}
			}
			console.error('Erro ao buscar cotação:', error);
			throw error;
		}
	}

	async listAllStocks(
		search = '',
		sortBy = 'name',
		sortOrder = 'asc',
		limit = 100,
		page = 1,
		sector?: string
	): Promise<any> {
		try {
			const apiKey = brapiApiKey;
			if (!apiKey) throw new Error('BRAPI_API_KEY não definida');

			const url = `${this.baseUrl}/quote/list?search=${search}&sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&page=${page}&type=stock${sector ? `&sector=${encodeURIComponent(sector)}` : ''}&token=${apiKey}`;
			const response = await firstValueFrom(this.httpService.get(url));
			return response.data;
		} catch (error) {
			console.error('Erro ao listar ações:', error);
			throw error;
		}
	}
}
