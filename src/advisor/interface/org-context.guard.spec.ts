import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MembershipService } from '../application/membership.service';
import { InMemoryMembershipStore } from '../application/in-memory-stores.fixture';
import { OrgRole } from '../domain/enums';
import { OrgContextGuard } from './org-context.guard';

function ctxOf(req: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
	} as unknown as ExecutionContext;
}

function reqFor(
	userId: string | undefined,
	headers: Record<string, unknown> = {}
) {
	return {
		user: userId ? { userId } : undefined,
		headers,
		orgContext: undefined as unknown,
	};
}

describe('OrgContextGuard', () => {
	let guard: OrgContextGuard;

	beforeEach(async () => {
		const store = new InMemoryMembershipStore();
		await store.create({ userId: 'u1', orgId: 'orgA', role: OrgRole.Advisor });
		await store.create({ userId: 'u1', orgId: 'orgB', role: OrgRole.OrgAdmin });
		guard = new OrgContextGuard(new MembershipService(store));
	});

	it('uses the first membership when there is no header', async () => {
		const req = reqFor('u1');
		await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
		expect(req.orgContext).toEqual({ orgId: 'orgA', role: OrgRole.Advisor });
	});

	it('uses the first membership when the header is blank', async () => {
		const req = reqFor('u1', { 'x-org-id': '   ' });
		await guard.canActivate(ctxOf(req));
		expect(req.orgContext).toEqual({ orgId: 'orgA', role: OrgRole.Advisor });
	});

	it('uses the requested org when the user is a member', async () => {
		const req = reqFor('u1', { 'x-org-id': 'orgB' });
		await guard.canActivate(ctxOf(req));
		expect(req.orgContext).toEqual({ orgId: 'orgB', role: OrgRole.OrgAdmin });
	});

	it('refuses an org where the user is not a member, never falling back', async () => {
		const req = reqFor('u1', { 'x-org-id': 'orgX' });
		await expect(guard.canActivate(ctxOf(req))).rejects.toThrow(
			ForbiddenException
		);
		expect(req.orgContext).toBeUndefined();
	});

	it('refuses a user without memberships, with or without header', async () => {
		await expect(guard.canActivate(ctxOf(reqFor('semOrg')))).rejects.toThrow(
			ForbiddenException
		);
		await expect(
			guard.canActivate(ctxOf(reqFor('semOrg', { 'x-org-id': 'orgA' })))
		).rejects.toThrow(ForbiddenException);
	});

	it('refuses an unauthenticated request', async () => {
		await expect(guard.canActivate(ctxOf(reqFor(undefined)))).rejects.toThrow(
			ForbiddenException
		);
	});

	it('refuses a repeated (array) header', async () => {
		const req = reqFor('u1', { 'x-org-id': ['orgA', 'orgB'] });
		await expect(guard.canActivate(ctxOf(req))).rejects.toThrow(
			ForbiddenException
		);
		expect(req.orgContext).toBeUndefined();
	});

	it('trims a padded header before matching the membership', async () => {
		const req = reqFor('u1', { 'x-org-id': ' orgB ' });
		await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
		expect(req.orgContext).toEqual({ orgId: 'orgB', role: OrgRole.OrgAdmin });
	});
});
