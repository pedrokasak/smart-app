import { Inject, Injectable } from '@nestjs/common';
import { Organization } from '../domain/entities';
import { AdvisorType } from '../domain/enums';
import { ADVISOR_ORG_STORE } from './advisor.tokens';
import type { OrganizationStorePort } from './ports/organization.store.port';

export interface CreateOrganizationInput {
	name: string;
	advisorType: AdvisorType;
	plan?: string;
}

@Injectable()
export class OrganizationService {
	constructor(
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort
	) {}

	create(input: CreateOrganizationInput): Promise<Organization> {
		return this.orgs.create({
			name: input.name,
			advisorType: input.advisorType,
			plan: input.plan,
		});
	}
}
