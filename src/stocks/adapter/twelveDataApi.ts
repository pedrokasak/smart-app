import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { StockApiAdapter } from './stockDataApi';
import { twelveDataApiKey } from 'src/env';

export class TwelveDataAdapter implements StockApiAdapter {
	private readonly baseUrl = 'https://api.twelvedata.com';

	constructor(private readonly httpService: HttpService) {}

	async getStockQuote(symbol: string): Promise<any> {
		const apiKey = twelveDataApiKey;
		console.log('🔑 TWELVE_DATA_API_KEY =', apiKey);
		if (!apiKey) throw new Error('TWELVE_DATA_API_KEY não definida');

		const url = `${this.baseUrl}/quote?symbol=${symbol}&apikey=${apiKey}`;
		const response = await firstValueFrom(this.httpService.get(url));
		return response.data;
	}
}
