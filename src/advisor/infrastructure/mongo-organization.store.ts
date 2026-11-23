import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { decodeIdCursor, encodeIdCursor } from '../application/id-cursor';
import { DuplicateOrganizationOwnerError } from '../application/ports/store-errors';
import { OrganizationStorePort } from '../application/ports/organization.store.port';
import { Organization } from '../domain/entities';
import { toOrganization } from './advisor.mappers';
import {
	ADVISOR_ORGANIZATION_MODEL,
	AdvisorOrganizationDoc,
	ORGANIZATION_OWNER_INDEX,
} from './advisor.models';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

@Injectable()
export class MongoOrganizationStore implements OrganizationStorePort {
	constructor(
		@InjectModel(ADVISOR_ORGANIZATION_MODEL)
		private readonly orgs: Model<AdvisorOrganizationDoc>
	) {}

	async create(org: Omit<Organization, 'id'>): Promise<Organization> {
		try {
			const created = await this.orgs.create(org);
			return toOrganization(created.toObject());
		} catch (error) {
			if (
				isDuplicateOnIndex(error, ORGANIZATION_OWNER_INDEX, ['ownerUserId'])
			) {
				throw new DuplicateOrganizationOwnerError();
			}
			throw error;
		}
	}

	async delete(id: string): Promise<void> {
		await this.orgs.deleteOne({ _id: id }).exec();
	}

	async listIds(
		cursor: string | undefined,
		limit: number
	): Promise<{ ids: string[]; nextCursor: string | null }> {
		const after = cursor === undefined ? null : decodeIdCursor(cursor);
		const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000);
		const docs = await this.orgs
			.find(after === null ? {} : { _id: { $gt: after } })
			.select({ _id: 1 })
			.sort({ _id: 1 })
			.limit(size + 1)
			.lean<Array<{ _id: string }>>()
			.exec();
		const ids = docs.slice(0, size).map((d) => d._id);
		return {
			ids,
			nextCursor:
				docs.length > size ? encodeIdCursor(ids[ids.length - 1]) : null,
		};
	}

	async findById(id: string): Promise<Organization | null> {
		const doc = await this.orgs
			.findById(id)
			.lean<AdvisorOrganizationDoc>()
			.exec();
		return doc ? toOrganization(doc) : null;
	}
}
