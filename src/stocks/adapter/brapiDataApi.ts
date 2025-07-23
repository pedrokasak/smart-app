import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { brapiApiKey } from 'src/env';
import { StockApiAdapter } from './stockDataApi';

export class BrapiAdapter implements StockApiAdapter {
	private readonly baseUrl = 'https://brapi.dev/api';

	constructor(private readonly httpService: HttpService) {}

	async getStockQuote(symbol: string): Promise<any> {
		const apiKey = brapiApiKey;
		console.log('🔑 BRAPI_TOKEN =', apiKey);
		if (!apiKey) throw new Error('BRAPI_API_KEY não definida');

		const url = `${this.baseUrl}/quote?symbol=${symbol}&token=${apiKey}`;
		const response = await firstValueFrom(
			this.httpService.request({ method: 'GET', url })
		);
		console.log('🔑 response =', response.data);
		return response.data;
	}
}
