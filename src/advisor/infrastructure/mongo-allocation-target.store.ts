import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AllocationTargetStorePort } from '../application/ports/allocation-target.store.port';
import { AllocationTarget } from '../domain/portfolio.entities';
import { toAllocationTarget } from './advisor.mappers';
import {
	ADVISOR_ALLOCATION_TARGET_MODEL,
	AdvisorAllocationTargetDoc,
} from './advisor-portfolio.models';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoAllocationTargetStore implements AllocationTargetStorePort {
	constructor(
		@InjectModel(ADVISOR_ALLOCATION_TARGET_MODEL)
		private readonly targets: Model<AdvisorAllocationTargetDoc>
	) {}

	/** Um documento por (orgId, clientProfileId); `targets` é substituído inteiro. */
	async upsert(
		target: Omit<AllocationTarget, 'updatedAt'>
	): Promise<AllocationTarget> {
		const { orgId, clientProfileId, targets, updatedByUserId } = target;
		const run = (): Promise<AdvisorAllocationTargetDoc> =>
			this.targets
				.findOneAndUpdate(
					{ orgId, clientProfileId },
					{ $set: { targets, updatedByUserId } },
					{
						upsert: true,
						new: true,
						runValidators: true,
						setDefaultsOnInsert: true,
					}
				)
				.lean<AdvisorAllocationTargetDoc>()
				.exec();
		try {
			return toAllocationTarget(await run());
		} catch (error) {
			// Dois primeiros upserts concorrentes: o perdedor bate no índice único;
			// repetir cai no caminho de update.
			if ((error as { code?: number } | null)?.code !== DUPLICATE_KEY) {
				throw error;
			}
			return toAllocationTarget(await run());
		}
	}

	async find(
		orgId: string,
		clientProfileId: string
	): Promise<AllocationTarget | null> {
		const doc = await this.targets
			.findOne({ orgId, clientProfileId })
			.lean<AdvisorAllocationTargetDoc>()
			.exec();
		return doc ? toAllocationTarget(doc) : null;
	}
}
