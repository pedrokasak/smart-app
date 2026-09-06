import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { deterministicEventId } from 'src/events/domain/deterministic-event-id';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { normalizeSymbol, readStaleness } from '../domain/quote-freshness';
import {
	QUOTE_FRESHNESS_STORE,
	QuoteFreshnessStore,
} from './ports/quote-freshness.port';

/**
 * Produtor de `market.quote.stale` (TRA-136, fase 7).
 *
 * Era o unico tipo declarado sem produtor, e ficou assim de proposito ate
 * existir um sinal de frescor de verdade — o `QuoteRefreshService` agora
 * grava, por simbolo, o instante da ultima leitura bem-sucedida.
 *
 * Tres decisoes definem o que este produtor faz e nao faz:
 *
 * 1. SO PARA QUEM TEM O PAPEL. A varredura parte das carteiras: um simbolo
 *    que ninguem carrega nao gera evento para ninguem. O evento e por
 *    usuario porque a notificacao e por usuario — "sua cotacao" so faz
 *    sentido se for sua.
 *
 * 2. SO COM CARIMBO ANTERIOR. Simbolo sem registro de leitura nao vira
 *    evento (`readStaleness` devolve `null`). Nunca ter sido lido com
 *    sucesso e outra coisa que ter parado de atualizar, e tratar os dois
 *    igual alertaria a base inteira no primeiro deploy, com a colecao
 *    vazia — o falso positivo que este produtor existe para nao cometer.
 *
 * 3. NAO DECIDE SE NOTIFICA. Publica o par (simbolo, idade da leitura); o
 *    corte, a borda e o cooldown sao do motor de limiares, que e o unico
 *    que guarda a leitura anterior. O produtor aplica so um pre-corte
 *    grosseiro (`emitAfterMinutes`) para nao publicar um evento por ativo
 *    por varredura — o motor derruba o resto.
 *
 * Nunca lanca: e chamado por cron, e um simbolo problematico nao pode matar
 * a varredura dos outros.
 */
@Injectable()
export class QuoteStaleProducer {
	private readonly logger = new Logger(QuoteStaleProducer.name);

	constructor(
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
		@Inject(QUOTE_FRESHNESS_STORE)
		private readonly freshness: QuoteFreshnessStore,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	/**
	 * Simbolos efetivamente carregados por alguem. E a lista que a varredura
	 * manda o provider atualizar: nao se gasta requisicao com papel que
	 * saiu de todas as carteiras.
	 */
	async heldSymbols(): Promise<string[]> {
		const raw: unknown[] = await this.assetModel
			.distinct('symbol', { quantity: { $gt: 0 } })
			.exec();
		return Array.from(new Set(raw.map(normalizeSymbol).filter(Boolean)));
	}

	/** Devolve quantos eventos foram publicados para este usuario. */
	async evaluateForUser(
		userId: string,
		emitAfterMinutes: number,
		now: Date = new Date()
	): Promise<number> {
		try {
			if (!Types.ObjectId.isValid(userId)) return 0;

			const symbols = await this.symbolsHeldBy(userId);
			if (symbols.length === 0) return 0;

			const records = await this.freshness.findBySymbols(symbols);
			const held = new Set(symbols);

			let published = 0;
			for (const record of records) {
				const reading = readStaleness(record, now);
				if (!reading || !held.has(reading.symbol)) continue;
				if (reading.minutesSinceLastQuote < emitAfterMinutes) continue;

				await this.publisher.publish(
					createDomainEvent({
						// Id derivado do EPISODIO (a leitura que ficou para tras)
						// mais o dia da varredura: varreduras repetidas no mesmo dia
						// colapsam no mesmo id e morrem no dedupe; dias diferentes
						// geram ids diferentes, para nao brigar com o re-arme por
						// cooldown do motor de limiares.
						id: deterministicEventId(
							DOMAIN_EVENT_TYPES.QuoteStale,
							userId,
							reading.symbol,
							reading.lastQuoteAt.toISOString(),
							dayKey(now)
						),
						type: DOMAIN_EVENT_TYPES.QuoteStale,
						subject: userId,
						producer: 'server.market.quote-freshness',
						payload: {
							symbol: reading.symbol,
							minutesSinceLastQuote: reading.minutesSinceLastQuote,
							lastQuoteAt: reading.lastQuoteAt.toISOString(),
						},
					})
				);
				published += 1;
			}

			return published;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao avaliar frescor de cotacao do usuario ${userId}: ${message}`
			);
			return 0;
		}
	}

	private async symbolsHeldBy(userId: string): Promise<string[]> {
		const portfolios = await this.portfolioModel
			.find({ userId })
			.select('_id')
			.lean<{ _id: Types.ObjectId }[]>();
		if (portfolios.length === 0) return [];

		const raw: unknown[] = await this.assetModel
			.distinct('symbol', {
				portfolioId: { $in: portfolios.map((p) => p._id) },
				// Posicao zerada nao e posicao. Avisar sobre a cotacao de um
				// papel que o usuario ja vendeu e ruido puro.
				quantity: { $gt: 0 },
			})
			.exec();

		return Array.from(new Set(raw.map(normalizeSymbol).filter(Boolean)));
	}
}

function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}
