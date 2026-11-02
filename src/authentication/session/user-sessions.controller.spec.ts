import { NotFoundException } from '@nestjs/common';
import { UserSessionsController } from './user-sessions.controller';
import { UserSessionService } from './user-session.service';

describe('UserSessionsController', () => {
	const sessions = {
		listForUser: jest.fn(),
		revoke: jest.fn(),
	};
	const controller = new UserSessionsController(
		sessions as unknown as UserSessionService
	);
	const req = { user: { userId: 'u1', sid: 's1' } };

	afterEach(() => jest.clearAllMocks());

	it('marca a sessão atual e lista só as do dono do token', async () => {
		sessions.listForUser.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

		await expect(controller.list(req)).resolves.toEqual([
			{ id: 's1', current: true },
			{ id: 's2', current: false },
		]);
		expect(sessions.listForUser).toHaveBeenCalledWith('u1');
	});

	it('revoga usando o dono do token', async () => {
		sessions.revoke.mockResolvedValue(true);

		await controller.revoke(req, 's2');

		expect(sessions.revoke).toHaveBeenCalledWith('s2', 'u1', 'user_request');
	});

	it('sessão alheia ou inexistente responde 404', async () => {
		sessions.revoke.mockResolvedValue(false);

		await expect(controller.revoke(req, 'other')).rejects.toThrow(
			NotFoundException
		);
	});
});
