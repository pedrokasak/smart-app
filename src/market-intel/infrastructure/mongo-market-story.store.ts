import { Injectable } from '@nestjs/common';
import { MarketStoryStore } from 'src/market-intel/application/market-intel.ports';
import { MarketStory } from 'src/market-intel/domain/market-intel.types';
import { MarketStoryModel } from './market-intel.models';

@Injectable()
export class MongoMarketStoryStore implements MarketStoryStore {
	async findBySeedHash(seedUrlHash: string): Promise<MarketStory | null> {
		return MarketStoryModel.findOne({ seedUrlHash }).lean();
	}

	async findUnindexed(limit: number): Promise<MarketStory[]> {
		return MarketStoryModel.find({ indexedAt: null })
			.sort({ latestAt: -1 })
			.limit(limit)
			.lean();
	}

	async upsert(story: MarketStory): Promise<void> {
		await MarketStoryModel.updateOne(
			{ seedUrlHash: story.seedUrlHash },
			{ $set: story },
			{ upsert: true }
		);
	}

	async markIndexed(seedUrlHash: string): Promise<void> {
		await MarketStoryModel.updateOne(
			{ seedUrlHash },
			{ $set: { indexedAt: new Date() } }
		);
	}
}
