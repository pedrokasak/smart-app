import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientSnapshotStorePort } from '../application/ports/client-snapshot.store.port';
import { ClientSnapshot } from '../domain/attention.entities';
import {
	ADVISOR_CLIENT_SNAPSHOT_MODEL,
	AdvisorClientSnapshotDoc,
} from './advisor-attention.models';
import { toClientSnapshot } from './advisor.mappers';
import { retryOnDuplicateKey } from './mongo-duplicate-key';

@Injectable()
export class MongoClientSnapshotStore implements ClientSnapshotStorePort {
	constructor(
		@InjectModel(ADVISOR_CLIENT_SNAPSHOT_MODEL)
		private readonly snapshots: Model<AdvisorClientSnapshotDoc>
	) {}

	/** Um documento por (orgId, clientProfileId); o resto é substituído. */
	async upsert(snapshot: ClientSnapshot): Promise<void> {
		const { orgId, clientProfileId, ...fields } = snapshot;
		await retryOnDuplicateKey(() =>
			this.snapshots
				.findOneAndUpdate(
					{ orgId, clientProfileId },
					{ $set: fields },
					{ upsert: true, runValidators: true, setDefaultsOnInsert: true }
				)
				.exec()
		);
	}

	async find(
		orgId: string,
		clientProfileId: string
	): Promise<ClientSnapshot | null> {
		const doc = await this.snapshots
			.findOne({ orgId, clientProfileId })
			.lean<AdvisorClientSnapshotDoc>()
			.exec();
		return doc ? toClientSnapshot(doc) : null;
	}

	async listByOrg(
		orgId: string,
		clientIds?: string[]
	): Promise<ClientSnapshot[]> {
		if (clientIds?.length === 0) return [];
		const docs = await this.snapshots
			.find({
				orgId,
				...(clientIds && { clientProfileId: { $in: clientIds } }),
			})
			.sort({ clientProfileId: 1 })
			.lean<AdvisorClientSnapshotDoc[]>()
			.exec();
		return docs.map(toClientSnapshot);
	}

	async delete(orgId: string, clientProfileId: string): Promise<void> {
		await this.snapshots.deleteOne({ orgId, clientProfileId }).exec();
	}
}
