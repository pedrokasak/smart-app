import { UsersService } from 'src/users/users.service';
import { UserPortalAccountDirectoryAdapter } from './user-portal-account-directory.adapter';

describe('UserPortalAccountDirectoryAdapter', () => {
	const userId = '65f1c2a4e1b2c3d4e5f60718';

	function build(
		byId: Record<
			string,
			{ email: string; firstName?: string; lastName?: string }
		>
	) {
		const users = {
			findByEmail: jest.fn(async (email: string) => {
				const id = Object.keys(byId).find((k) => byId[k].email === email);
				return id ? { _id: id, email } : null;
			}),
			findOne: jest.fn(async (id: string) => byId[id] ?? null),
		};
		const adapter = new UserPortalAccountDirectoryAdapter(
			users as unknown as UsersService
		);
		return { adapter, users };
	}

	it('finds the account id by e-mail, null when there is none', async () => {
		const { adapter } = build({ [userId]: { email: 'a@example.com' } });
		expect(await adapter.findUserIdByEmail('a@example.com')).toBe(userId);
		expect(await adapter.findUserIdByEmail('b@example.com')).toBeNull();
		expect(await adapter.findUserIdByEmail('')).toBeNull();
	});

	it('returns e-mails of existing accounts only and skips malformed ids', async () => {
		const { adapter, users } = build({ [userId]: { email: 'a@example.com' } });
		const missing = '65f1c2a4e1b2c3d4e5f60719';

		const emails = await adapter.findEmails([userId, missing, 'nope', userId]);

		expect([...emails]).toEqual([[userId, 'a@example.com']]);
		expect(users.findOne).toHaveBeenCalledTimes(2);
		expect(users.findOne).not.toHaveBeenCalledWith('nope');
	});
	it('returns name and e-mail of existing accounts, skipping malformed ids', async () => {
		const noName = '65f1c2a4e1b2c3d4e5f60720';
		const missing = '65f1c2a4e1b2c3d4e5f60719';
		const { adapter } = build({
			[userId]: {
				email: 'a@example.com',
				firstName: ' Ana ',
				lastName: 'Lima',
			},
			[noName]: { email: 'b@example.com' },
		});

		const profiles = await adapter.findProfiles([
			userId,
			noName,
			missing,
			'nope',
		]);

		expect([...profiles]).toEqual([
			[userId, { name: 'Ana Lima', email: 'a@example.com' }],
			[noName, { name: '', email: 'b@example.com' }],
		]);
	});
});
