import * as ccxt from 'ccxt';

export interface ExchangeCredentials {
	apiKey: string;
	secret: string;
	password?: string;
}

export interface ExchangeProvider {
	readonly id: string;
	createClient(credentials: ExchangeCredentials): ccxt.Exchange;
}
