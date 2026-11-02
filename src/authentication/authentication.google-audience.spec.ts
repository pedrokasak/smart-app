import { UnauthorizedException } from '@nestjs/common';
import { UserModel } from 'src/users/schema/user.model';
import { AuthenticationService } from './authentication.service';

jest.mock('src/env', () => ({
	...jest.requireActual('src/env'),
	googleClientIds: ['web-client', 'ios-client'],
}));

jest.mock('src/users/schema/user.model', () => ({
	UserModel: { findOne: jest.fn(), create: jest.fn() },
}));

describe('AuthenticationService — audiências do Google', () => {
	const originalFetch = global.fetch;
	const passwords = { hashPassword: jest.fn().mockResolvedValue('hash') };
	const jwt = {
		sign: jest.fn().mockReturnValue('signed'),
		decode: jest.fn().mockReturnValue({ exp: 4102444800 }),
	};
	const sessions = { open: jest.fn() };
	const service = new AuthenticationService(
		jwt as any,
		{} as any,
		{} as any,
		passwords as any,
		{} as any,
		sessions as any
	);

	const tokenFor = (aud: string) => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				aud,
				email: 'a@b.com',
				email_verified: 'true',
				given_name: 'Ana',
			}),
		}) as any;
	};

	const signin = () =>
		service.googleSignin({ idToken: 'x'.repeat(50), keepConnected: false });

	beforeEach(() => {
		jest.clearAllMocks();
		(UserModel.findOne as jest.Mock).mockReturnValue({
			select: () => ({ exec: jest.fn().mockResolvedValue(null) }),
		});
		(UserModel.create as jest.Mock).mockResolvedValue({
			id: 'u1',
			email: 'a@b.com',
			save: jest.fn(),
		});
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	it.each(['web-client', 'ios-client'])('aceita %s', async (aud) => {
		tokenFor(aud);

		await expect(signin()).resolves.toHaveProperty('accessToken');
	});

	it('recusa token emitido para outro app', async () => {
		tokenFor('other-app');

		await expect(signin()).rejects.toThrow(UnauthorizedException);
		expect(UserModel.create).not.toHaveBeenCalled();
	});

	it('conta nova gera uma senha só, sem Argon2 duplicado', async () => {
		tokenFor('web-client');

		await signin();

		expect(passwords.hashPassword).toHaveBeenCalledTimes(1);
	});
});
