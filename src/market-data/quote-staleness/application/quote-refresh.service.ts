import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	MarketAssetSnapshot,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { normalizeSymbol } from '../domain/quote-freshness';
import {
	QUOTE_FRESHNESS_STORE,
	QuoteFreshnessStore,
} from './ports/quote-freshness.port';

export interface QuoteRefreshResult {
	/** Simbolos pedidos (unicos, normalizados). */
	requested: number;
	/** Simbolos que voltaram com preco e tiveram o carimbo gravado. */
	stamped: number;
}

/**
 * A varredura que faltava (TRA-136, fase 7).
 *
 * Este servico e o UNICO escritor do carimbo de frescor, e a razao de o
 * evento `market.quote.stale` poder existir sem mentir. Ate agora o
 * provider era chamado sob demanda e nao deixava rastro; sem uma leitura
 * periodica, "cotacao parada" nao era mensuravel — o sistema so saberia que
 * uma cotacao esta velha se alguem pedisse por ela.
 *
 * A regra que sustenta a honestidade do sinal e uma so: SO GRAVA QUANDO A
 * LEITURA DEU CERTO E VEIO PRECO. Snapshot sem preco, provider que lancou,
 * simbolo que a fonte nao cobre — nenhum deles escreve. E a AUSENCIA de
 * escrita que faz o relogio do simbolo andar; gravar no caminho de erro
 * (com "tentamos agora") transformaria a fonte fora do ar em silencio
 * eterno, que e exatamente o alerta que se quer dar.
 */
@Injectable()
export class QuoteRefreshService {
	private readonly logger = new Logger(QuoteRefreshService.name);

	constructor(
		@Inject(MARKET_DATA_PROVIDER)
		private readonly provider: MarketDataProviderPort,
		@Inject(QUOTE_FRESHNESS_STORE)
		private readonly freshness: QuoteFreshnessStore
	) {}

	async refresh(
		symbols: string[],
		now: Date = new Date()
	): Promise<QuoteRefreshResult> {
		const unique = Array.from(
			new Set(symbols.map(normalizeSymbol).filter(Boolean))
		);
		if (unique.length === 0) return { requested: 0, stamped: 0 };

		let snapshots: MarketAssetSnapshot[] = [];
		try {
			snapshots = await this.provider.getManyAssetSnapshots(unique);
		} catch (err) {
			// Falha da varredura inteira nao pode gravar nada: sem carimbo, o
			// tempo continua correndo para todos os simbolos, que e a leitura
			// correta do que aconteceu.
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Varredura de cotacao falhou: ${message}`);
			return { requested: unique.length, stamped: 0 };
		}

		const records = snapshots
			.filter(
				(snapshot) =>
					!!snapshot &&
					typeof snapshot.price === 'number' &&
					Number.isFinite(snapshot.price)
			)
			.map((snapshot) => ({
				symbol: normalizeSymbol(snapshot.symbol),
				// `asOf` e o instante em que a FONTE respondeu. O `now` da
				// varredura so entra quando o provider nao carimbou.
				lastQuoteAt: parseAsOf(snapshot.metadata?.asOf, now),
				lastPrice: snapshot.price,
				source: snapshot.metadata?.source ?? null,
			}))
			.filter((record) => !!record.symbol);

		if (records.length > 0) {
			await this.freshness.recordReads(records);
		}

		return { requested: unique.length, stamped: records.length };
	}
}

function parseAsOf(asOf: string | undefined, fallback: Date): Date {
	if (!asOf) return fallback;
	const parsed = new Date(asOf);
	return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}
