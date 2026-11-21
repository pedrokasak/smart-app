import {
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
} from '@nestjs/common';
import { Membership } from '../domain/entities';
import { OrgRole } from '../domain/enums';
import { ADVISOR_MEMBERSHIP_STORE } from './advisor.tokens';
import type { MembershipStorePort } from './ports/membership.store.port';
import { DuplicateMembershipError } from './ports/store-errors';

@Injectable()
export class MembershipService {
	constructor(
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort
	) {}

	async add(userId: string, orgId: string, role: OrgRole): Promise<Membership> {
		try {
			return await this.memberships.create({ userId, orgId, role });
		} catch (error) {
			if (error instanceof DuplicateMembershipError) {
				throw new ConflictException(
					'User is already a member of this organization'
				);
			}
			throw error;
		}
	}

	listForUser(userId: string): Promise<Membership[]> {
		return this.memberships.findByUser(userId);
	}

	/**
	 * Org ativa: o usuário precisa ser membro da org pedida, sem queda para
	 * outro vínculo. A org é sempre explícita (header `x-org-id`).
	 */
	async resolveActiveOrg(
		userId: string,
		requestedOrgId: string
	): Promise<Membership> {
		const all = await this.memberships.findByUser(userId);
		if (all.length === 0) {
			throw new ForbiddenException('User has no organization membership');
		}
		const requested = all.find((m) => m.orgId === requestedOrgId);
		if (!requested) {
			throw new ForbiddenException('User is not a member of this organization');
		}
		return requested;
	}
}
