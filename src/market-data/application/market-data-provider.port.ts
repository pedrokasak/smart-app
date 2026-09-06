export type MarketAssetType =
	| 'stock'
	| 'fii'
	| 'crypto'
	| 'etf'
	| 'fund'
	| 'other';

export interface MarketAssetSnapshot {
	symbol: string;
	assetType: MarketAssetType;
	sector: string | null;
	price: number | null;
	dividendYield: number | null;
	performance: {
		changePercent: number | null;
	};
	fundamentals: {
		priceToEarnings: number | null;
		priceToBook: number | null;
		returnOnEquity: number | null;
		netMargin: number | null;
		evEbitda: number | null;
		marketCap: number | null;
	};
	metadata: {
		source: 'primary' | 'fallback_fundamentus';
		fallbackUsed: boolean;
		partial: boolean;
		fallbackSources: string[];
		/**
		 * ISO-8601 do instante em que ESTA leitura foi obtida com sucesso
		 * (TRA-136, fase 7).
		 *
		 * Existe porque o provider busca sob demanda e nao guardava nenhum
		 * carimbo: quem recebia um snapshot nao tinha como saber se ele veio
		 * agora ou de um cache de horas atras. Sem isso, o unico timestamp de
		 * mercado persistido no sistema era `Asset.lastEnrichedAt`, que marca
		 * o cadastro do ativo e nao a cotacao — usa-lo como "ultima cotacao"
		 * alertaria todo ativo um dia depois de criado.
		 *
		 * Opcional no tipo, e nao obrigatorio, para nao quebrar as
		 * construcoes de snapshot que ja existem (comparacao, radar de
		 * oportunidade). O facade preenche em todo caminho de retorno; quem
		 * consome como sinal de frescor trata a ausencia como "sem leitura".
		 */
		asOf?: string;
	};
}

export interface MarketDataProviderPort {
	getAssetSnapshot(symbol: string): Promise<MarketAssetSnapshot | null>;
	getManyAssetSnapshots(symbols: string[]): Promise<MarketAssetSnapshot[]>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');
