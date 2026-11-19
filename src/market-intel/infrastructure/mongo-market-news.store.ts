import { Injectable } from '@nestjs/common';
import { MarketNewsStore } from 'src/market-intel/application/market-intel.ports';
import { MarketNewsItem } from 'src/market-intel/domain/market-intel.types';
import { MarketNewsItemModel } from './market-intel.models';

@Injectable()
export class MongoMarketNewsStore implements MarketNewsStore {
	async existsByUrlHash(urlHash: string): Promise<boolean> {
		return !!(await MarketNewsItemModel.exists({ urlHash }));
	}

	async existsByContentHash(contentHash: string): Promise<boolean> {
		return !!(await MarketNewsItemModel.exists({ contentHash }));
	}

	async findRecentSimHashes(
		windowHours: number
	): Promise<{ urlHash: string; simHash: string }[]> {
		const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
		return MarketNewsItemModel.find(
			{ publishedAt: { $gte: since }, status: { $ne: 'duplicate' } },
			{ urlHash: 1, simHash: 1, _id: 0 }
		).lean();
	}

	async findPending(limit: number): Promise<MarketNewsItem[]> {
		return MarketNewsItemModel.find({ status: 'pending' })
			.sort({ publishedAt: -1 })
			.limit(limit)
			.lean();
	}

	async insert(item: MarketNewsItem): Promise<void> {
		await MarketNewsItemModel.create(item);
	}

	async markDuplicate(urlHash: string): Promise<void> {
		await MarketNewsItemModel.updateOne(
			{ urlHash },
			{ $set: { status: 'duplicate' } },
			{ upsert: false }
		);
	}

	async assignStory(urlHash: string, storyId: string): Promise<void> {
		await MarketNewsItemModel.updateOne({ urlHash }, { $set: { storyId } });
	}

	async markAnalyzed(urlHash: string): Promise<void> {
		await MarketNewsItemModel.updateOne(
			{ urlHash },
			{ $set: { status: 'analyzed', analyzedAt: new Date() } }
		);
	}

	async markFailed(urlHash: string, error: string): Promise<void> {
		await MarketNewsItemModel.updateOne(
			{ urlHash },
			{ $set: { status: 'failed', lastError: error } }
		);
	}
}
