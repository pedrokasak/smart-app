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
		try {
			const params = new URLSearchParams();
			if (options?.range) params.append('range', options.range);
			if (options?.interval) params.append('interval', options.interval);
			if (options?.fundamental) params.append('fundamental', 'true');
			if (options?.dividends) params.append('dividends', 'true');

			const url = `${this.baseUrl}/quote/${symbols}${params.toString() ? `?${params.toString()}` : ''}`;
			const response = await firstValueFrom(
				this.httpService.get(url, {
					headers: {
						'User-Agent': 'SmartFolio App',
						'Content-Type': 'application/json',
					},
				})
			);
			console.log('BRAPI Response:', response.data);

			return response.data;
		} catch (error) {
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
