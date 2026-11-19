import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrganizationStorePort } from '../application/ports/organization.store.port';
import { Organization } from '../domain/entities';
import { toOrganization } from './advisor.mappers';
import {
	ADVISOR_ORGANIZATION_MODEL,
	AdvisorOrganizationDoc,
} from './advisor.models';

@Injectable()
export class MongoOrganizationStore implements OrganizationStorePort {
	constructor(
		@InjectModel(ADVISOR_ORGANIZATION_MODEL)
		private readonly orgs: Model<AdvisorOrganizationDoc>
	) {}

	async create(org: Omit<Organization, 'id'>): Promise<Organization> {
		const created = await this.orgs.create(org);
		return toOrganization(created.toObject());
	}

	async findById(id: string): Promise<Organization | null> {
		const doc = await this.orgs
			.findById(id)
			.lean<AdvisorOrganizationDoc>()
			.exec();
		return doc ? toOrganization(doc) : null;
	}
}
