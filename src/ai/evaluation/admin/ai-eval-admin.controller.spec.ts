import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AiEvalAdminController } from 'src/ai/evaluation/admin/ai-eval-admin.controller';
import { AiEvalService } from 'src/ai/evaluation/application/ai-eval.service';

function contextFor(role: Role, handler: unknown): ExecutionContext {
	return {
		getHandler: () => handler,
		getClass: () => AiEvalAdminController,
		switchToHttp: () => ({
			getRequest: () => ({ user: { userId: 'u1', role } }),
		}),
	} as unknown as ExecutionContext;
}

describe('AiEvalAdminController (TRA-242)', () => {
	const guard = new RolesGuard(new Reflector());
	let evaluation: { latest: jest.Mock; run: jest.Mock; isRunning: boolean };

	beforeEach(() => {
		evaluation = {
			latest: jest
				.fn()
				.mockResolvedValue({ createdAt: '2026-10-05T09:00:00.000Z' }),
			run: jest.fn().mockResolvedValue(null),
			isRunning: false,
		};
	});

	const controller = () =>
		new AiEvalAdminController(evaluation as unknown as AiEvalService);

	it.each([
		['latest', AiEvalAdminController.prototype.latest],
		['run', AiEvalAdminController.prototype.run],
	])('keeps %s admin-only', (_name, handler) => {
		expect(guard.canActivate(contextFor(Role.Admin, handler))).toBe(true);
		expect(() => guard.canActivate(contextFor(Role.Editor, handler))).toThrow();
		expect(() => guard.canActivate(contextFor(Role.User, handler))).toThrow();
	});

	it('returns the latest report', async () => {
		await expect(controller().latest()).resolves.toEqual({
			report: { createdAt: '2026-10-05T09:00:00.000Z' },
		});
	});

	it('starts a run in the background', () => {
		expect(controller().run()).toEqual({ status: 'started' });
		expect(evaluation.run).toHaveBeenCalled();
	});

	it('does not start a second run', () => {
		evaluation.isRunning = true;

		expect(controller().run()).toEqual({ status: 'already_running' });
		expect(evaluation.run).not.toHaveBeenCalled();
	});
});
