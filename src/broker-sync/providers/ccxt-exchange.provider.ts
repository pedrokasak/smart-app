import * as ccxt from 'ccxt';
import {
	ExchangeCredentials,
	ExchangeProvider,
} from 'src/broker-sync/providers/exchange-provider.interface';

export class CcxtExchangeProvider implements ExchangeProvider {
	constructor(public readonly id: string) {}

	createClient(credentials: ExchangeCredentials): ccxt.Exchange {
		const Ctor = (ccxt as any)[this.id];
		if (!Ctor) {
			throw new Error(`ccxt exchange not found: ${this.id}`);
		}

		return new Ctor({
			apiKey: credentials.apiKey,
			secret: credentials.secret,
			...(credentials.password ? { password: credentials.password } : {}),
			enableRateLimit: true,
		});
	}
}
