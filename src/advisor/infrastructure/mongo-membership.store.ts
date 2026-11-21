import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DuplicateMembershipError } from '../application/ports/store-errors';
import { MembershipStorePort } from '../application/ports/membership.store.port';
import { Membership } from '../domain/entities';
import { toMembership } from './advisor.mappers';
import {
	ADVISOR_MEMBERSHIP_MODEL,
	AdvisorMembershipDoc,
	MEMBERSHIP_USER_ORG_INDEX,
} from './advisor.models';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

@Injectable()
export class MongoMembershipStore implements MembershipStorePort {
	constructor(
		@InjectModel(ADVISOR_MEMBERSHIP_MODEL)
		private readonly memberships: Model<AdvisorMembershipDoc>
	) {}

	/** Vínculo duplicado (userId, orgId) vira `DuplicateMembershipError`. */
	async create(membership: Omit<Membership, 'id'>): Promise<Membership> {
		try {
			const created = await this.memberships.create(membership);
			return toMembership(created.toObject());
		} catch (error) {
			if (
				isDuplicateOnIndex(error, MEMBERSHIP_USER_ORG_INDEX, [
					'userId',
					'orgId',
				])
			) {
				throw new DuplicateMembershipError();
			}
			throw error;
		}
	}

	async findByUser(userId: string): Promise<Membership[]> {
		const docs = await this.memberships
			.find({ userId })
			.sort({ createdAt: 1, _id: 1 })
			.lean<AdvisorMembershipDoc[]>()
			.exec();
		return docs.map(toMembership);
	}

	async findByUserAndOrg(
		userId: string,
		orgId: string
	): Promise<Membership | null> {
		const doc = await this.memberships
			.findOne({ userId, orgId })
			.lean<AdvisorMembershipDoc>()
			.exec();
		return doc ? toMembership(doc) : null;
	}
}
