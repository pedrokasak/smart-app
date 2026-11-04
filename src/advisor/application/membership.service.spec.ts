import { ForbiddenException } from '@nestjs/common';
import { AdvisorType, OrgRole } from '../domain/enums';
import {
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
} from './in-memory-stores.fixture';
import { MembershipService } from './membership.service';
import { OrganizationService } from './organization.service';

describe('OrganizationService', () => {
	it('creates an organization', async () => {
		const svc = new OrganizationService(new InMemoryOrganizationStore());
		const org = await svc.create({
			name: 'Acme',
			advisorType: AdvisorType.Assessor,
			plan: 'pro',
		});
		expect(org.id).toBeDefined();
		expect(org).toMatchObject({
			name: 'Acme',
			advisorType: AdvisorType.Assessor,
			plan: 'pro',
		});
	});
});

describe('MembershipService', () => {
	let svc: MembershipService;

	beforeEach(() => {
		svc = new MembershipService(new InMemoryMembershipStore());
	});

	it('adds a membership and lists it for the user', async () => {
		const m = await svc.add('u1', 'orgA', OrgRole.Advisor);
		expect(m).toMatchObject({
			userId: 'u1',
			orgId: 'orgA',
			role: OrgRole.Advisor,
		});
		expect(await svc.listForUser('u1')).toEqual([m]);
		expect(await svc.listForUser('u2')).toEqual([]);
	});

	describe('resolveActiveOrg', () => {
		it('throws Forbidden when the user has no membership', async () => {
			await expect(svc.resolveActiveOrg('u1')).rejects.toThrow(
				ForbiddenException
			);
			await expect(svc.resolveActiveOrg('u1', 'orgA')).rejects.toThrow(
				ForbiddenException
			);
		});

		it('returns the first membership when no org is requested', async () => {
			await svc.add('u1', 'orgA', OrgRole.Advisor);
			await svc.add('u1', 'orgB', OrgRole.OrgAdmin);
			expect((await svc.resolveActiveOrg('u1')).orgId).toBe('orgA');
		});

		it('returns the requested org when the user is a member', async () => {
			await svc.add('u1', 'orgA', OrgRole.Advisor);
			await svc.add('u1', 'orgB', OrgRole.OrgAdmin);
			expect((await svc.resolveActiveOrg('u1', 'orgB')).orgId).toBe('orgB');
		});

		it('falls back to the first membership, never the requested org, when not a member', async () => {
			await svc.add('u1', 'orgA', OrgRole.Advisor);
			await svc.add('u1', 'orgB', OrgRole.OrgAdmin);
			expect((await svc.resolveActiveOrg('u1', 'orgX')).orgId).toBe('orgA');
		});
	});
});
