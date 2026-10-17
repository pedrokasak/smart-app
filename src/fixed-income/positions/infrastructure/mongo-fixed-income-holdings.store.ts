import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Asset } from 'src/assets/schema/assets.model';
import {
	CURVE_PRICE_SOURCE,
	FIXED_INCOME_ASSET_TYPE,
} from '../../domain/fixed-income-asset';
import type { FixedIncomeValuation } from '../../domain/fixed-income.types';
import type {
	FixedIncomeHolding,
	FixedIncomeHoldingsStore,
} from '../application/fixed-income-positions.ports';

@Injectable()
export class MongoFixedIncomeHoldingsStore implements FixedIncomeHoldingsStore {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	async listAll(): Promise<FixedIncomeHolding[]> {
		const docs = await this.assetModel
			.find(
				{ type: FIXED_INCOME_ASSET_TYPE, fixedIncome: { $ne: null } },
				{ fixedIncome: 1 }
			)
			.lean()
			.exec();
		return docs.map((doc: any) => {
			const data = doc.fixedIncome;
			return {
				id: String(doc._id),
				position: {
					kind: data.kind,
					indexer: data.indexer,
					ratePct: data.ratePct,
					principal: data.principal,
					appliedAt: data.appliedAt,
					maturityDate: data.maturityDate ?? null,
				},
			};
		});
	}

	async applyValuations(
		items: { id: string; valuation: FixedIncomeValuation }[],
		markedAt: Date
	): Promise<number> {
		if (!items.length) return 0;
		const result = await this.assetModel.bulkWrite(
			items.map(({ id, valuation }) => ({
				updateOne: {
					filter: { _id: id, type: FIXED_INCOME_ASSET_TYPE },
					update: {
						$set: {
							currentPrice: valuation.grossValue,
							total: valuation.grossValue,
							currentPriceAt: markedAt,
							currentPriceSource: CURVE_PRICE_SOURCE,
							'fixedIncome.valuation': valuation,
						},
					},
				},
			}))
		);
		return result.modifiedCount;
	}
}
