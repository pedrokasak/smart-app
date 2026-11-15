import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VoiceConsentOrigin } from '../domain/voice.constants';
import {
	VoiceConsentRecord,
	VoiceConsentRepositoryPort,
	VoiceUsagePort,
} from '../application/voice.ports';
import {
	VoiceConsent,
	VoiceConsentDocument,
	VoiceUsage,
	VoiceUsageDocument,
} from './voice.schemas';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoVoiceConsentAdapter implements VoiceConsentRepositoryPort {
	constructor(
		@InjectModel(VoiceConsent.name)
		private readonly model: Model<VoiceConsentDocument>
	) {}

	async find(userId: string): Promise<VoiceConsentRecord | null> {
		return this.model.findOne({ userId }).lean<VoiceConsentRecord>().exec();
	}

	async accept(
		userId: string,
		version: string,
		origin: VoiceConsentOrigin,
		at: Date
	): Promise<void> {
		await this.model
			.updateOne(
				{ userId },
				{ $set: { version, origin, acceptedAt: at, revokedAt: null } },
				{ upsert: true }
			)
			.exec();
	}

	async revoke(userId: string, at: Date): Promise<boolean> {
		const result = await this.model
			.updateOne({ userId, revokedAt: null }, { $set: { revokedAt: at } })
			.exec();
		return result.modifiedCount > 0;
	}
}

@Injectable()
export class MongoVoiceUsageAdapter implements VoiceUsagePort {
	constructor(
		@InjectModel(VoiceUsage.name)
		private readonly model: Model<VoiceUsageDocument>
	) {}

	async tryConsume(
		userId: string,
		day: string,
		limit: number
	): Promise<boolean> {
		try {
			// Só incrementa abaixo do teto. Com o teto cheio o filtro não casa,
			// o upsert tenta criar um segundo documento do mesmo dia e o índice
			// único recusa: é assim que "não coube" volta, sem corrida.
			await this.model
				.updateOne(
					{ userId, day, count: { $lt: limit } },
					{ $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
					{ upsert: true }
				)
				.exec();
			return true;
		} catch (error: any) {
			if (error?.code !== DUPLICATE_KEY) throw error;
			// Também cai aqui quando dois pedidos abrem o dia ao mesmo tempo: o
			// documento já existe, então tenta de novo sem upsert. Só o teto cheio
			// volta como "não coube".
			const retry = await this.model
				.updateOne(
					{ userId, day, count: { $lt: limit } },
					{ $inc: { count: 1 } }
				)
				.exec();
			return retry.modifiedCount > 0;
		}
	}

	async release(userId: string, day: string): Promise<void> {
		await this.model
			.updateOne({ userId, day, count: { $gt: 0 } }, { $inc: { count: -1 } })
			.exec();
	}
}
