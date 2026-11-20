import { UsersService } from 'src/users/users.service';
import { UserInviteeIdentityAdapter } from './user-invitee-identity.adapter';

describe('UserInviteeIdentityAdapter', () => {
	const userId = '65f1c2a4e1b2c3d4e5f60718';

	function build(user: unknown) {
		const users = { findOne: jest.fn().mockResolvedValue(user) };
		const adapter = new UserInviteeIdentityAdapter(
			users as unknown as UsersService
		);
		return { adapter, users };
	}

	it('returns the e-mail of a verified account', async () => {
		const { adapter, users } = build({
			email: 'a@example.com',
			isEmailVerified: true,
		});

		expect(await adapter.find(userId)).toEqual({
			email: 'a@example.com',
			emailVerified: true,
		});
		expect(users.findOne).toHaveBeenCalledWith(userId);
	});

	it('reports an unverified account as not verified', async () => {
		const { adapter } = build({
			email: 'a@example.com',
			isEmailVerified: false,
		});

		expect(await adapter.find(userId)).toEqual({
			email: 'a@example.com',
			emailVerified: false,
		});
	});

	it('treats a missing flag as not verified', async () => {
		const { adapter } = build({ email: 'a@example.com' });

		expect((await adapter.find(userId))?.emailVerified).toBe(false);
	});

	it('gives null for an unknown user', async () => {
		const { adapter } = build(null);

		expect(await adapter.find(userId)).toBeNull();
	});

	it('gives null for a malformed id without querying', async () => {
		const { adapter, users } = build({ email: 'a@example.com' });

		expect(await adapter.find('not-an-object-id')).toBeNull();
		expect(users.findOne).not.toHaveBeenCalled();
	});
});
