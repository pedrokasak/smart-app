import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import { AdvisorPortalGuard } from './advisor-portal.guard';

function ctxOf(req: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
	} as unknown as ExecutionContext;
}

describe('AdvisorPortalGuard', () => {
	const hasAccess = jest.fn();
	const guard = new AdvisorPortalGuard({
		hasAccess,
	} as unknown as PortalAccessService);

	beforeEach(() => hasAccess.mockReset());

	it('lets a user with portal access through, asking by the JWT user', async () => {
		hasAccess.mockResolvedValue(true);
		await expect(
			guard.canActivate(ctxOf({ user: { userId: 'u1' } }))
		).resolves.toBe(true);
		expect(hasAccess).toHaveBeenCalledWith('u1');
	});

	it('denies without access with PLAN_CAPABILITY_REQUIRED for advisor.portal', async () => {
		hasAccess.mockResolvedValue(false);
		const error = await guard
			.canActivate(ctxOf({ user: { userId: 'u1' } }))
			.catch((e) => e);
		expect(error).toBeInstanceOf(ForbiddenException);
		expect(error.getResponse()).toMatchObject({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
			capability: 'advisor.portal',
		});
	});

	it('fails closed without an authenticated user, never asking the port', async () => {
		await expect(guard.canActivate(ctxOf({}))).rejects.toBeInstanceOf(
			ForbiddenException
		);
		expect(hasAccess).not.toHaveBeenCalled();
	});
});
