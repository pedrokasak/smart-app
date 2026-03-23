import * as ccxt from 'ccxt';
import {
	ExchangeCredentials,
	ExchangeProvider,
} from 'src/broker-sync/providers/exchange-provider.interface';

export class CcxtExchangeProvider implements ExchangeProvider {
	constructor(public readonly id: string) {}

	private normalizeCoinbaseSecret(secret: string): string {
		let normalized = String(secret || '').trim();
		if (!normalized) return normalized;

		// Usuários costumam salvar com \n literal no frontend/env.
		normalized = normalized.replace(/\\n/g, '\n');

		if (normalized.includes('BEGIN') && normalized.includes('END')) {
			return normalized;
		}

		// Fallback: tenta montar PEM quando veio apenas o conteúdo base64 da key.
		if (!normalized.includes('\n')) {
			const chunks = normalized.match(/.{1,64}/g) || [normalized];
			return [
				'-----BEGIN EC PRIVATE KEY-----',
				...chunks,
				'-----END EC PRIVATE KEY-----',
			].join('\n');
		}

		return normalized;
	}

	createClient(credentials: ExchangeCredentials): ccxt.Exchange {
		const Ctor = (ccxt as any)[this.id];
		if (!Ctor) {
			throw new Error(`ccxt exchange not found: ${this.id}`);
		}

		const isBinance = this.id === 'binance';
		const isCoinbase = this.id === 'coinbase';
		return new Ctor({
			apiKey: credentials.apiKey,
			secret: isCoinbase
				? this.normalizeCoinbaseSecret(credentials.secret)
				: credentials.secret,
			...(credentials.password ? { password: credentials.password } : {}),
			enableRateLimit: true,
			...(isBinance
				? {
						options: {
							adjustForTimeDifference: true,
							recvWindow: 60000,
						},
					}
				: {}),
		});
	}
}
