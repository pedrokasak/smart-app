import { Injectable } from '@nestjs/common';
import { MarketSourceStore } from 'src/market-intel/application/market-intel.ports';
import { MarketSource } from 'src/market-intel/domain/market-intel.types';
import { MarketSourceModel } from './market-intel.models';

@Injectable()
export class MongoMarketSourceStore implements MarketSourceStore {
	async findAll(): Promise<MarketSource[]> {
		return MarketSourceModel.find().lean();
	}

	async findEnabled(): Promise<MarketSource[]> {
		return MarketSourceModel.find({ enabled: true }).lean();
	}

	async findById(id: string): Promise<MarketSource | null> {
		return MarketSourceModel.findOne({ id }).lean();
	}

	async save(source: MarketSource): Promise<void> {
		await MarketSourceModel.updateOne(
			{ id: source.id },
			{ $set: source },
			{ upsert: true }
		);
	}

	async updateFetchMeta(
		id: string,
		meta: { etag: string | null; lastModified: string | null; lastFetchedAt: Date }
	): Promise<void> {
		await MarketSourceModel.updateOne({ id }, { $set: meta });
	}
}
