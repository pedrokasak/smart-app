import { ConflictException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { AdvisorType, OrgRole } from '../domain/enums';
import {
	InMemoryInviteeIdentity,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
} from './in-memory-stores.fixture';
import { MembershipService } from './membership.service';
import {
	OrganizationRuleError,
	OrganizationService,
} from './organization.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}
}

describe('OrganizationService', () => {
	let orgs: InMemoryOrganizationStore;
	let memberships: InMemoryMembershipStore;
	let identity: InMemoryInviteeIdentity;
	let audit: FakeAuditTrail;
	let svc: OrganizationService;
	const input = { name: 'Acme Assessoria', advisorType: AdvisorType.Assessor };

	beforeEach(() => {
		orgs = new InMemoryOrganizationStore();
		memberships = new InMemoryMembershipStore();
		identity = new InMemoryInviteeIdentity();
		identity.set('u1', { email: 'dono@acme.com', emailVerified: true });
		audit = new FakeAuditTrail();
		svc = new OrganizationService(
			orgs,
			new MembershipService(memberships),
			identity,
			audit
		);
	});

	it('creates an organization (legacy create)', async () => {
		const org = await svc.create({
			name: 'Acme',
			advisorType: AdvisorType.Assessor,
			plan: 'pro',
		});
		expect(org).toMatchObject({ name: 'Acme', plan: 'pro' });
	});

	describe('createForOwner', () => {
		it('creates the org with the owner, the ORG_ADMIN membership and an audit event with ids only', async () => {
			const org = await svc.createForOwner('u1', {
				...input,
				name: '  Acme Assessoria  ',
			});

			expect(org).toMatchObject({
				name: 'Acme Assessoria',
				advisorType: AdvisorType.Assessor,
				ownerUserId: 'u1',
			});
			expect(await memberships.findByUserAndOrg('u1', org.id)).toMatchObject({
				role: OrgRole.OrgAdmin,
			});
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0]).toMatchObject({
				type: 'advisor.organization.created',
				version: 1,
				subject: org.id,
				actorRef: actorRefOf('u1'),
				payload: { orgId: org.id },
			});
			expect(JSON.stringify(audit.recorded[0])).not.toContain('Acme');
		});

		it('rejects an unverified e-mail with 403 and creates nothing', async () => {
			identity.set('u2', { email: 'x@acme.com', emailVerified: false });
			const error = await svc
				.createForOwner('u2', input)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(OrganizationRuleError);
			expect(error).toMatchObject({ reason: 'EMAIL_NOT_VERIFIED' });
			expect((error as OrganizationRuleError).getStatus()).toBe(403);
			expect(await memberships.findByUser('u2')).toEqual([]);
		});

		it('treats an unknown account as unverified', async () => {
			await expect(svc.createForOwner('ghost', input)).rejects.toMatchObject({
				reason: 'EMAIL_NOT_VERIFIED',
			});
		});

		it.each([
			['1 character', 'a'],
			['121 characters', 'a'.repeat(121)],
			['a control character', 'Acme\u0007Corp'],
			['only blanks', '    '],
			['a right-to-left override', 'Acme\u202ECorp'],
			['a zero-width space', 'Acme\u200BCorp'],
		])('rejects a name with %s with 400 INVALID_NAME', async (_label, name) => {
			const error = await svc
				.createForOwner('u1', { ...input, name })
				.catch((e: unknown) => e);
			expect(error).toMatchObject({ reason: 'INVALID_NAME' });
			expect((error as OrganizationRuleError).getStatus()).toBe(400);
			expect(await memberships.findByUser('u1')).toEqual([]);
		});

		it('accepts names of exactly 2 and 120 characters', async () => {
			await expect(
				svc.createForOwner('u1', { ...input, name: 'ab' })
			).resolves.toMatchObject({ name: 'ab' });
			identity.set('u3', { email: 'c@acme.com', emailVerified: true });
			await expect(
				svc.createForOwner('u3', { ...input, name: 'a'.repeat(120) })
			).resolves.toBeDefined();
		});

		it('rejects an unknown advisor type with 400', async () => {
			await expect(
				svc.createForOwner('u1', {
					name: 'Acme',
					advisorType: 'BANQUEIRO' as AdvisorType,
				})
			).rejects.toMatchObject({ reason: 'INVALID_ADVISOR_TYPE' });
		});

		it('rejects a blank userId without touching any store', async () => {
			const spy = jest.spyOn(orgs, 'create');
			await expect(svc.createForOwner('', input)).rejects.toThrow(
				'userId is required'
			);
			await expect(svc.createForOwner('   ', input)).rejects.toThrow(
				'userId is required'
			);
			expect(spy).not.toHaveBeenCalled();
		});

		it('turns a second organization for the same owner into 409 ALREADY_OWNS_ORGANIZATION', async () => {
			await svc.createForOwner('u1', input);
			const error = await svc
				.createForOwner('u1', input)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ConflictException);
			expect(error).toMatchObject({ reason: 'ALREADY_OWNS_ORGANIZATION' });
			expect(audit.recorded).toHaveLength(1);
		});

		it('deletes the organization and rethrows when the membership fails', async () => {
			const boom = new Error('membership down');
			jest.spyOn(memberships, 'create').mockRejectedValue(boom);
			const deleteSpy = jest.spyOn(orgs, 'delete');

			await expect(svc.createForOwner('u1', input)).rejects.toBe(boom);

			expect(deleteSpy).toHaveBeenCalledTimes(1);
			const orgId = deleteSpy.mock.calls[0][0];
			expect(await orgs.findById(orgId)).toBeNull();
		});

		it('deletes the organization, creates no membership and rethrows when the audit fails', async () => {
			const boom = new Error('audit down');
			audit.failWith = boom;
			const deleteSpy = jest.spyOn(orgs, 'delete');

			await expect(svc.createForOwner('u1', input)).rejects.toBe(boom);

			expect(await memberships.findByUser('u1')).toEqual([]);
			expect(await orgs.findById(deleteSpy.mock.calls[0][0])).toBeNull();
		});

		it('rethrows the original error even if the compensation fails', async () => {
			const boom = new Error('membership down');
			jest.spyOn(memberships, 'create').mockRejectedValue(boom);
			jest.spyOn(orgs, 'delete').mockRejectedValue(new Error('delete down'));
			jest
				.spyOn((svc as any).logger, 'error')
				.mockImplementation(() => undefined);

			await expect(svc.createForOwner('u1', input)).rejects.toBe(boom);
		});
	});

	describe('listForUser', () => {
		it('lists the organizations of the user with the role', async () => {
			const org = await svc.createForOwner('u1', input);
			const other = await orgs.create({
				name: 'Beta',
				advisorType: AdvisorType.Consultor,
			});
			await memberships.create({
				userId: 'u1',
				orgId: other.id,
				role: OrgRole.Advisor,
			});
			await memberships.create({
				userId: 'u9',
				orgId: other.id,
				role: OrgRole.OrgAdmin,
			});

			const list = await svc.listForUser('u1');

			expect(list).toEqual([
				{
					id: org.id,
					name: 'Acme Assessoria',
					advisorType: AdvisorType.Assessor,
					role: OrgRole.OrgAdmin,
				},
				{
					id: other.id,
					name: 'Beta',
					advisorType: AdvisorType.Consultor,
					role: OrgRole.Advisor,
				},
			]);
		});

		it('returns an empty list for a user without memberships', async () => {
			expect(await svc.listForUser('nobody')).toEqual([]);
		});
	});
});
