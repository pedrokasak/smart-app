import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RiWatchAdminController } from 'src/ri-intelligence/watch/admin/ri-watch-admin.controller';
import { RiWatchMetricsService } from 'src/ri-intelligence/watch/application/ri-watch-metrics.service';

function contextFor(role: Role): ExecutionContext {
	return {
		getHandler: () => RiWatchAdminController.prototype.getMetrics,
		getClass: () => RiWatchAdminController,
		switchToHttp: () => ({
			getRequest: () => ({ user: { userId: 'u1', role } }),
		}),
	} as unknown as ExecutionContext;
}

describe('RiWatchAdminController (TRA-267)', () => {
	const guard = new RolesGuard(new Reflector());

	it('lets an admin read the metrics', () => {
		expect(guard.canActivate(contextFor(Role.Admin))).toBe(true);
	});

	it.each([Role.User, Role.Editor])('keeps %p out', (role) => {
		expect(() => guard.canActivate(contextFor(role))).toThrow();
	});

	it('returns the metrics overview', async () => {
		const metrics = {
			overview: jest.fn().mockResolvedValue({ windowDays: 30 }),
		};
		const controller = new RiWatchAdminController(
			metrics as unknown as RiWatchMetricsService
		);

		await expect(controller.getMetrics()).resolves.toEqual({ windowDays: 30 });
	});
});
