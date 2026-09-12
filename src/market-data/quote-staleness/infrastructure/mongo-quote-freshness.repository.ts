import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QuoteFreshnessStore } from '../application/ports/quote-freshness.port';
import {
	QuoteFreshnessRecord,
	normalizeSymbol,
} from '../domain/quote-freshness';
import { QuoteFreshnessDocument } from './quote-freshness.model';

/**
 * Adaptador Mongo da porta de frescor. Unico arquivo desta feature que
 * conhece Mongoose.
 *
 * A escrita e um `bulkWrite` de upserts por simbolo: a varredura grava
 * centenas de carimbos de uma vez e nao ha nada a ler entre eles. O indice
 * unico em `symbol` fecha a corrida entre duas varreduras concorrentes; o
 * upsert evita o erro de chave duplicada.
 *
 * `$max` em `lastQuoteAt` para que uma varredura atrasada (retry, fila de
 * jobs fora de ordem) nunca ANDE O CARIMBO PARA TRAS e invente atraso que
 * nao houve.
 */
@Injectable()
export class MongoQuoteFreshnessRepository implements QuoteFreshnessStore {
	constructor(
		@InjectModel('QuoteFreshness')
		private readonly model: Model<QuoteFreshnessDocument>
	) {}

	async recordReads(records: QuoteFreshnessRecord[]): Promise<void> {
		const operations = records
			.map((record) => ({
				symbol: normalizeSymbol(record.symbol),
				lastQuoteAt: new Date(record.lastQuoteAt),
				lastPrice:
					typeof record.lastPrice === 'number' &&
					Number.isFinite(record.lastPrice)
						? record.lastPrice
						: null,
				source: record.source ?? null,
			}))
			.filter(
				(record) =>
					!!record.symbol && Number.isFinite(record.lastQuoteAt.getTime())
			)
			.map((record) => ({
				updateOne: {
					filter: { symbol: record.symbol },
					update: {
						$max: { lastQuoteAt: record.lastQuoteAt },
						$set: { lastPrice: record.lastPrice, source: record.source },
					},
					upsert: true,
				},
			}));

		if (operations.length === 0) return;
		await this.model.bulkWrite(operations);
	}

	async findBySymbols(symbols: string[]): Promise<QuoteFreshnessRecord[]> {
		const unique = Array.from(
			new Set(symbols.map(normalizeSymbol).filter(Boolean))
		);
		if (unique.length === 0) return [];

		const docs = await this.model
			.find({ symbol: { $in: unique } })
			.select('symbol lastQuoteAt lastPrice source')
			.lean<QuoteFreshnessDocument[]>();

		return docs.map((doc) => ({
			symbol: normalizeSymbol(doc.symbol),
			lastQuoteAt: new Date(doc.lastQuoteAt),
			lastPrice: doc.lastPrice ?? null,
			source: doc.source ?? null,
		}));
	}
}
