import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { OrgPortalGuard } from './org-portal.guard';

function ctxOf(req: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
	} as unknown as ExecutionContext;
}

const req = (orgId = 'org1') => ({
	user: { userId: 'member1' },
	orgContext: { orgId, role: 'ADVISOR' },
});

describe('OrgPortalGuard', () => {
	const ownerOf = jest.fn();
	const hasAccess = jest.fn();
	const guard = new OrgPortalGuard(
		{ ownerOf } as unknown as OrganizationService,
		{ hasAccess } as unknown as PortalAccessService
	);

	beforeEach(() => {
		ownerOf.mockReset();
		hasAccess.mockReset();
	});

	it('asks about the org owner, not the requesting member', async () => {
		ownerOf.mockResolvedValue('owner1');
		hasAccess.mockResolvedValue(true);
		await expect(guard.canActivate(ctxOf(req()))).resolves.toBe(true);
		expect(ownerOf).toHaveBeenCalledWith('org1');
		expect(hasAccess).toHaveBeenCalledWith('owner1');
		expect(hasAccess).not.toHaveBeenCalledWith('member1');
	});

	it('denies with PLAN_CAPABILITY_REQUIRED for advisor.portal when the owner has no access', async () => {
		ownerOf.mockResolvedValue('owner1');
		hasAccess.mockResolvedValue(false);
		const error = await guard.canActivate(ctxOf(req())).catch((e) => e);
		expect(error).toBeInstanceOf(ForbiddenException);
		expect(error.getResponse()).toMatchObject({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
			capability: 'advisor.portal',
		});
	});

	it('denies an organization without owner, never asking the port', async () => {
		ownerOf.mockResolvedValue(null);
		await expect(guard.canActivate(ctxOf(req()))).rejects.toBeInstanceOf(
			ForbiddenException
		);
		expect(hasAccess).not.toHaveBeenCalled();
	});

	it('is a wiring error (500) when OrgContextGuard did not run', async () => {
		await expect(
			guard.canActivate(ctxOf({ user: { userId: 'member1' } }))
		).rejects.toMatchObject({ status: 500 });
		expect(ownerOf).not.toHaveBeenCalled();
	});
});
