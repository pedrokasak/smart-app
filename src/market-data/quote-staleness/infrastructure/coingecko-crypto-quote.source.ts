import { Injectable, Logger } from '@nestjs/common';
import { CryptoQuoteSource } from '../application/ports/crypto-quote.port';
import {
	QuoteFreshnessRecord,
	normalizeSymbol,
} from '../domain/quote-freshness';

/**
 * Símbolo → id da CoinGecko. Só entra aqui o que tem id inequívoco: LUNC é
 * a Terra Classic (`terra-luna`), LUNA é a Terra 2.0 (`terra-luna-2`).
 */
export const COINGECKO_IDS: Record<string, string> = {
	BTC: 'bitcoin',
	ETH: 'ethereum',
	USDT: 'tether',
	USDC: 'usd-coin',
	FDUSD: 'first-digital-usd',
	BNB: 'binancecoin',
	ADA: 'cardano',
	DOGE: 'dogecoin',
	SOL: 'solana',
	XRP: 'ripple',
	LTC: 'litecoin',
	TRX: 'tron',
	AVAX: 'avalanche-2',
	LINK: 'chainlink',
	DOT: 'polkadot',
	MATIC: 'matic-network',
	POL: 'polygon-ecosystem-token',
	ARB: 'arbitrum',
	OP: 'optimism',
	SHIB: 'shiba-inu',
	LUNC: 'terra-luna',
	LUNA: 'terra-luna-2',
	ETHW: 'ethereum-pow-iou',
	BCH: 'bitcoin-cash',
	ATOM: 'cosmos',
	NEAR: 'near',
	UNI: 'uniswap',
	PEPE: 'pepe',
	TON: 'the-open-network',
};

const BASE_URL = 'https://api.coingecko.com/api/v3/simple/price';

@Injectable()
export class CoinGeckoCryptoQuoteSource implements CryptoQuoteSource {
	private readonly logger = new Logger(CoinGeckoCryptoQuoteSource.name);

	/** Substituível nos testes. */
	fetchImpl: typeof fetch = (input, init) => fetch(input, init);

	async quote(symbols: string[]): Promise<QuoteFreshnessRecord[]> {
		const bySymbol = new Map<string, string>();
		for (const raw of symbols) {
			const symbol = normalizeSymbol(raw);
			const id = COINGECKO_IDS[symbol];
			if (id) bySymbol.set(symbol, id);
		}
		if (bySymbol.size === 0) return [];

		const ids = Array.from(new Set(bySymbol.values())).join(',');
		try {
			// Uma chamada para todos os símbolos: o plano público tem limite
			// baixo por minuto.
			const response = await this.fetchImpl(
				`${BASE_URL}?ids=${ids}&vs_currencies=brl&include_last_updated_at=true`,
				{ signal: AbortSignal.timeout(10_000) }
			);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = (await response.json()) as Record<
				string,
				{ brl?: number; last_updated_at?: number }
			>;

			const records: QuoteFreshnessRecord[] = [];
			for (const [symbol, id] of bySymbol) {
				const price = body?.[id]?.brl;
				if (
					typeof price !== 'number' ||
					!Number.isFinite(price) ||
					price <= 0
				) {
					continue;
				}
				const updated = body[id].last_updated_at;
				records.push({
					symbol,
					lastPrice: price,
					lastQuoteAt: updated ? new Date(updated * 1000) : new Date(),
					source: 'coingecko',
				});
			}
			return records;
		} catch (error) {
			this.logger.warn(
				`CoinGecko indisponível: ${error instanceof Error ? error.message : error}`
			);
			return [];
		}
	}
}
