import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RiDocumentTextCachePort } from 'src/ri-intelligence/application/ri-document-text-cache.port';
import { RiDocumentTextDocument } from './ri-document-text.model';

/**
 * Teto do texto guardado. O PDF ja chega limitado a 25 MB; o texto de um
 * formulario enorme ainda pode passar de alguns MB, e o Mongo recusa
 * documento acima de 16 MB. Acima do teto nao guarda — so baixa de novo.
 */
const MAX_CACHED_CHARS = 3_000_000;

/** Adaptador Mongo do cache de texto de documento de RI (TRA-253). */
@Injectable()
export class MongoRiDocumentTextCacheAdapter implements RiDocumentTextCachePort {
	constructor(
		@InjectModel('RiDocumentText')
		private readonly model: Model<RiDocumentTextDocument>
	) {}

	async get(key: string): Promise<string | null> {
		const doc = await this.model
			.findOne({ key })
			.lean<RiDocumentTextDocument | null>();
		if (!doc) return null;
		// O indice TTL apaga em lote: entre a expiracao e a varredura o
		// documento ainda existe e nao pode ser servido.
		if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now()) {
			return null;
		}
		return doc.text || null;
	}

	async set(key: string, text: string, ttlSeconds: number): Promise<void> {
		if (!text || text.length > MAX_CACHED_CHARS) return;
		const ttl = Number(ttlSeconds || 0);
		const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null;
		await this.model.updateOne(
			{ key },
			{ $set: { text, expiresAt } },
			{ upsert: true }
		);
	}
}
