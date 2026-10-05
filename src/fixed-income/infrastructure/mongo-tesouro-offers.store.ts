import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
	StoredTesouroOffers,
	TesouroOffersSnapshot,
	TesouroOffersStore,
} from '../application/ports/tesouro-offers.ports';
import type { TesouroFamily } from '../domain/tesouro-title';
import type { TesouroOffersSnapshotDocument } from './tesouro-offers-snapshot.model';

const SNAPSHOT_ID = 'latest';

/** Único arquivo do módulo que conhece Mongoose. */
@Injectable()
export class MongoTesouroOffersStore implements TesouroOffersStore {
	constructor(
		@InjectModel('TesouroOffersSnapshot')
		private readonly model: Model<TesouroOffersSnapshotDocument>
	) {}

	async load(): Promise<StoredTesouroOffers | null> {
		const doc = await this.model
			.findById(SNAPSHOT_ID, { _id: 0 })
			.lean()
			.exec();
		if (!doc) return null;
		return {
			baseDate: doc.baseDate,
			sourceUrl: doc.sourceUrl,
			fetchedAt: doc.fetchedAt,
			titles: doc.titles.map((title) => ({
				id: title.id,
				family: title.family as TesouroFamily,
				name: title.name,
				maturityDate: title.maturityDate,
				buyRatePct: title.buyRatePct,
				sellRatePct: title.sellRatePct,
				unitPrice: title.unitPrice,
				baseDate: title.baseDate,
			})),
		};
	}

	async save(snapshot: TesouroOffersSnapshot, fetchedAt: Date): Promise<void> {
		await this.model
			.replaceOne(
				{ _id: SNAPSHOT_ID },
				{ _id: SNAPSHOT_ID, ...snapshot, fetchedAt },
				{ upsert: true }
			)
			.exec();
	}
}
