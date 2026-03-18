import { ExchangeProvider } from 'src/broker-sync/providers/exchange-provider.interface';
import { CcxtExchangeProvider } from 'src/broker-sync/providers/ccxt-exchange.provider';

export class ProviderRegistry {
	private readonly providers = new Map<string, ExchangeProvider>();

	constructor(extraProviders: ExchangeProvider[] = []) {
		// Default CCXT-backed providers
		[
			'binance',
			'coinbase',
			'bitso',
			'mercadobitcoin',
			// Add more IDs here as you enable them in the UI
		].forEach((id) => this.register(new CcxtExchangeProvider(id)));

		extraProviders.forEach((p) => this.register(p));
	}

	register(provider: ExchangeProvider) {
		this.providers.set(provider.id, provider);
	}

	get(providerId: string): ExchangeProvider | undefined {
		return this.providers.get(providerId);
	}

	listIds(): string[] {
		return Array.from(this.providers.keys());
	}
}
