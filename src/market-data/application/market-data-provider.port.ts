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

/** Fechamento diário de um símbolo. `date` em YYYY-MM-DD. */
export interface DailyClose {
	date: string;
	close: number;
}

export interface MarketDataProviderPort {
	getAssetSnapshot(symbol: string): Promise<MarketAssetSnapshot | null>;
	getManyAssetSnapshots(symbols: string[]): Promise<MarketAssetSnapshot[]>;
	/**
	 * Série de fechamentos diários, para métricas que exigem retornos pareados
	 * dia-a-dia — beta e tracking error contra índice (TRA-141).
	 *
	 * Devolve `[]` quando a fonte não tem o símbolo ou está indisponível: quem
	 * consome decide se a métrica fica indisponível, em vez de receber exceção
	 * no meio de um cálculo.
	 *
	 * `assetType` define como o símbolo é normalizado na fonte: ação e FII
	 * ganham `.SA`, cripto vira par em reais (BTC-BRL). Omitir trata como ação,
	 * que é o comportamento anterior — índice (`^BVSP`) segue intocado.
	 */
	getDailyCloses(
		symbol: string,
		range: string,
		assetType?: MarketAssetType
	): Promise<DailyClose[]>;
}

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');
