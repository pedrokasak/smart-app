import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Membership } from '../domain/entities';
import { OrgRole } from '../domain/enums';
import { ADVISOR_MEMBERSHIP_STORE } from './advisor.tokens';
import type { MembershipStorePort } from './ports/membership.store.port';

@Injectable()
export class MembershipService {
	constructor(
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort
	) {}

	add(userId: string, orgId: string, role: OrgRole): Promise<Membership> {
		return this.memberships.create({ userId, orgId, role });
	}

	listForUser(userId: string): Promise<Membership[]> {
		return this.memberships.findByUser(userId);
	}

	/**
	 * Org ativa: a pedida só vale se o usuário for membro; caso contrário o
	 * primeiro vínculo. Nunca devolve uma org da qual o usuário não participa.
	 */
	async resolveActiveOrg(
		userId: string,
		requestedOrgId?: string
	): Promise<Membership> {
		const all = await this.memberships.findByUser(userId);
		if (all.length === 0) {
			throw new ForbiddenException('User has no organization membership');
		}
		const requested = requestedOrgId
			? all.find((m) => m.orgId === requestedOrgId)
			: undefined;
		return requested ?? all[0];
	}
}
