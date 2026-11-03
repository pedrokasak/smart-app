import { Injectable } from '@nestjs/common';
import { MarketIngestRunStore } from 'src/market-intel/application/market-intel.ports';
import { MarketIngestRun } from 'src/market-intel/domain/market-intel.types';
import { MarketIngestRunModel } from './market-intel.models';

@Injectable()
export class MongoMarketIngestRunStore implements MarketIngestRunStore {
	async start(startedAt: Date, sourcesTotal: number): Promise<string> {
		const doc = await MarketIngestRunModel.create({
			startedAt,
			sourcesTotal,
			sourcesFetched: 0,
			sourcesFailed: 0,
			itemsFound: 0,
			itemsNew: 0,
			itemsDuplicate: 0,
			storiesCreated: 0,
			storiesMerged: 0,
			errors: [],
		});
		return String(doc._id);
	}

	async finish(
		id: string,
		result: Omit<MarketIngestRun, 'startedAt' | 'finishedAt' | 'sourcesTotal'>
	): Promise<void> {
		await MarketIngestRunModel.updateOne(
			{ _id: id },
			{ $set: { ...result, finishedAt: new Date() } }
		);
	}
}
