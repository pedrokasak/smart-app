import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
	WealthDailyRow,
	WealthDailyStorePort,
	WealthDailySum,
} from '../application/ports/wealth-daily.store.port';
import { SnapshotSource } from '../domain/enums';
import {
	ADVISOR_WEALTH_DAILY_MODEL,
	AdvisorWealthDailyDoc,
} from './advisor-attention.models';
import { retryOnDuplicateKey } from './mongo-duplicate-key';

@Injectable()
export class MongoWealthDailyStore implements WealthDailyStorePort {
	constructor(
		@InjectModel(ADVISOR_WEALTH_DAILY_MODEL)
		private readonly rows: Model<AdvisorWealthDailyDoc>
	) {}

	/** Sem carteira (livro do assessor) a chave usa `''`, não a ausência. */
	async upsert(row: WealthDailyRow): Promise<void> {
		const { totalMinor, verifiedMinor, manualMinor, portfolioId, ...key } = row;
		await retryOnDuplicateKey(() =>
			this.rows
				.findOneAndUpdate(
					{ ...key, portfolioId: portfolioId ?? '' },
					{ $set: { totalMinor, verifiedMinor, manualMinor } },
					{ upsert: true, runValidators: true, setDefaultsOnInsert: true }
				)
				.exec()
		);
	}

	async deleteSource(
		orgId: string,
		clientProfileId: string,
		source: SnapshotSource,
		portfolioId?: string
	): Promise<void> {
		await this.rows
			.deleteMany({
				orgId,
				clientProfileId,
				source,
				...(portfolioId !== undefined && { portfolioId }),
			})
			.exec();
	}

	async deleteClient(orgId: string, clientProfileId: string): Promise<void> {
		await this.rows.deleteMany({ orgId, clientProfileId }).exec();
	}

	async sumByDate(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<WealthDailySum[]> {
		if (clientIds?.length === 0) return [];
		return this.rows
			.aggregate<WealthDailySum>([
				{ $match: this.filter(orgId, { $gte: from, $lte: to }, clientIds) },
				{
					$group: {
						_id: '$date',
						totalMinor: { $sum: '$totalMinor' },
						verifiedMinor: { $sum: '$verifiedMinor' },
						manualMinor: { $sum: '$manualMinor' },
						clientSet: { $addToSet: '$clientProfileId' },
					},
				},
				{
					$project: {
						_id: 0,
						date: '$_id',
						totalMinor: 1,
						verifiedMinor: 1,
						manualMinor: 1,
						clients: { $size: '$clientSet' },
					},
				},
				{ $sort: { date: 1 } },
			])
			.exec();
	}

	async clientIdsOn(
		orgId: string,
		date: string,
		clientIds?: string[]
	): Promise<string[]> {
		if (clientIds?.length === 0) return [];
		return this.rows
			.distinct('clientProfileId', this.filter(orgId, date, clientIds))
			.exec();
	}

	private filter(
		orgId: string,
		date: FilterQuery<AdvisorWealthDailyDoc>['date'],
		clientIds?: string[]
	): FilterQuery<AdvisorWealthDailyDoc> {
		return {
			orgId,
			date,
			...(clientIds && { clientProfileId: { $in: clientIds } }),
		};
	}
}
