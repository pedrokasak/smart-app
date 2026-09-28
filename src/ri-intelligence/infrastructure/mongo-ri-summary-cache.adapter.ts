import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RiSummaryCachePort } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { RiSummaryCacheDocument } from 'src/ri-intelligence/infrastructure/ri-summary-cache.model';

/**
 * Adaptador Mongo da porta de cache do resumo de RI (TRA-238). Unico arquivo
 * do resumo que conhece Mongoose.
 *
 * Gravacao por upsert na chave unica: dois usuarios abrindo o mesmo release
 * ao mesmo tempo gravam o mesmo documento, nao dois.
 */
@Injectable()
export class MongoRiSummaryCacheAdapter<T> implements RiSummaryCachePort<T> {
	constructor(
		@InjectModel('RiSummaryCache')
		private readonly model: Model<RiSummaryCacheDocument>
	) {}

	async get(key: string): Promise<T | null> {
		const doc = await this.model
			.findOne({ key })
			.lean<RiSummaryCacheDocument | null>();
		if (!doc) return null;

		// O indice TTL apaga em lote: entre a expiracao e a varredura o
		// documento ainda existe e nao pode ser servido.
		if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now()) {
			return null;
		}
		return doc.value as T;
	}

	async set(key: string, value: T, ttlSeconds = 0): Promise<void> {
		const ttl = Number(ttlSeconds || 0);
		const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null;

		await this.model.updateOne(
			{ key },
			{ $set: { value, expiresAt } },
			{ upsert: true }
		);
	}
}
