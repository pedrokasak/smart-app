import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PortalGrantStorePort } from '../application/ports/portal-grant.store.port';
import { PortalGrant } from '../domain/portal-access';
import {
	ADVISOR_PORTAL_GRANT_MODEL,
	AdvisorPortalGrantDoc,
	PORTAL_GRANT_USER_ACTIVE_INDEX,
} from './advisor-portal-grant.models';
import { toPortalGrant } from './advisor.mappers';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

/**
 * Uma corrida perdida significa que outra liberação do mesmo usuário entrou
 * primeiro; a tentativa seguinte já a encontra.
 */
const MAX_GRANT_ATTEMPTS = 3;

@Injectable()
export class MongoPortalGrantStore implements PortalGrantStorePort {
	constructor(
		@InjectModel(ADVISOR_PORTAL_GRANT_MODEL)
		private readonly grants: Model<AdvisorPortalGrantDoc>
	) {}

	/**
	 * Lê a ativa e só insere sem ela. Uma inserção concorrente do mesmo
	 * usuário bate no índice único parcial e relê; qualquer outro erro sobe.
	 */
	async grant(
		userId: string,
		grantedBy: string,
		at: Date
	): Promise<PortalGrant> {
		for (let attempt = 1; attempt <= MAX_GRANT_ATTEMPTS; attempt += 1) {
			const active = await this.findActive(userId);
			if (active) return active;
			try {
				const created = await this.grants.create({
					userId,
					grantedBy,
					grantedAt: at,
					active: true,
				});
				return toPortalGrant(created.toObject());
			} catch (error) {
				if (
					!isDuplicateOnIndex(error, PORTAL_GRANT_USER_ACTIVE_INDEX, ['userId'])
				) {
					throw error;
				}
			}
		}
		throw new Error('Portal grant kept colliding; giving up');
	}

	async revoke(userId: string, at: Date): Promise<boolean> {
		const result = await this.grants
			.updateOne(
				{ userId, active: true },
				{ $set: { active: false, revokedAt: at } }
			)
			.exec();
		return result.modifiedCount > 0;
	}

	async findActive(userId: string): Promise<PortalGrant | null> {
		const doc = await this.grants
			.findOne({ userId, active: true })
			.lean<AdvisorPortalGrantDoc>()
			.exec();
		return doc ? toPortalGrant(doc) : null;
	}

	async deleteAllForUser(userId: string): Promise<number> {
		const result = await this.grants.deleteMany({ userId }).exec();
		return result.deletedCount ?? 0;
	}

	async listActive(): Promise<PortalGrant[]> {
		const docs = await this.grants
			.find({ active: true })
			.sort({ grantedAt: 1, _id: 1 })
			.lean<AdvisorPortalGrantDoc[]>()
			.exec();
		return docs.map(toPortalGrant);
	}
}
