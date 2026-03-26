import { Injectable } from '@nestjs/common';
import {
	RiAssetAutocompletePort,
	RiAssetSuggestion,
} from 'src/ri-intelligence/application/ri-asset-autocomplete.port';
import { StockService } from 'src/stocks/stocks.service';

@Injectable()
export class StocksRiAssetAutocompleteAdapter implements RiAssetAutocompletePort {
	constructor(private readonly stockService: StockService) {}

	async search(query: string, limit: number): Promise<RiAssetSuggestion[]> {
		const normalizedQuery = String(query || '').trim();
		if (!normalizedQuery) return [];

		const response = await this.stockService.getAllNational(
			normalizedQuery,
			Math.max(1, Math.min(limit, 30)),
			1,
			'name'
		);

		const list = Array.isArray(response?.stocks)
			? response.stocks
			: Array.isArray(response)
				? response
				: [];

		const unique = new Map<string, RiAssetSuggestion>();
		for (const item of list) {
			const ticker = String(item?.stock || item?.symbol || item?.ticker || '')
				.trim()
				.toUpperCase();
			if (!ticker) continue;
			const company = String(item?.name || item?.company || ticker).trim();
			if (!company) continue;
			if (!unique.has(ticker)) {
				unique.set(ticker, { ticker, company });
			}
		}

		return Array.from(unique.values()).slice(0, limit);
	}
}
