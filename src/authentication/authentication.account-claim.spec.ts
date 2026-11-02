import { UserModel } from 'src/users/schema/user.model';
import { AuthenticationService } from './authentication.service';

jest.mock('src/env', () => ({
	...jest.requireActual('src/env'),
	googleClientIds: ['web-client'],
}));

jest.mock('src/users/schema/user.model', () => ({
	UserModel: {
		findOne: jest.fn(),
		findById: jest.fn(),
		updateOne: jest.fn(),
		create: jest.fn(),
	},
}));

/** Pré-registro: alguém cria conta de senha com o e-mail de outra pessoa. */
describe('AuthenticationService — conta de senha nunca verificada', () => {
	const originalFetch = global.fetch;
	const updateOne = UserModel.updateOne as jest.Mock;
	const passwords = { hashPassword: jest.fn().mockResolvedValue('new-hash') };
	const emails = { sendPasswordChangedEmail: jest.fn() };
	const sessions = {
		open: jest.fn(),
		revokeAll: jest.fn().mockResolvedValue(undefined),
	};
	const audit = { emit: jest.fn() };
	const jwt = {
		sign: jest.fn().mockReturnValue('signed'),
		decode: jest.fn().mockReturnValue({ exp: 4102444800 }),
	};
	const service = new AuthenticationService(
		jwt as any,
		{} as any,
		emails as any,
		passwords as any,
		{} as any,
		sessions as any,
		audit as any
	);

	const account = (overrides: object = {}) => ({
		_id: 'u1',
		id: 'u1',
		email: 'ana@b.com',
		firstName: 'Ana',
		lastName: 'Silva',
		isEmailVerified: false,
		twoFactorEnabled: false,
		role: 'user',
		save: jest.fn(),
		...overrides,
	});

	const googleLogin = (user: object) => {
		(UserModel.findOne as jest.Mock).mockReturnValue({
			select: () => ({ exec: jest.fn().mockResolvedValue(user) }),
		});
		(UserModel.findById as jest.Mock).mockReturnValue({
			select: () => ({ exec: jest.fn().mockResolvedValue(user) }),
		});
		return service.googleSignin({
			idToken: 'x'.repeat(50),
			keepConnected: false,
		});
	};

	beforeEach(() => {
		jest.clearAllMocks();
		updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				aud: 'web-client',
				email: 'ana@b.com',
				email_verified: 'true',
			}),
		}) as any;
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	const claimWrite = () =>
		updateOne.mock.calls.find(([, update]) => update.$set?.password);

	it('descarta a senha, encerra as sessões e avisa a pessoa', async () => {
		await googleLogin(account());

		expect(sessions.revokeAll).toHaveBeenCalledWith('u1', 'account_claimed');
		const [filter, update] = claimWrite();
		expect(filter).toEqual({ _id: 'u1' });
		expect(update.$set).toMatchObject({
			password: 'new-hash',
			isEmailVerified: true,
			refreshToken: null,
		});
		expect(update.$unset).toHaveProperty('resetPasswordToken');
		expect(emails.sendPasswordChangedEmail).toHaveBeenCalledWith(
			'ana@b.com',
			'Ana'
		);
		expect(audit.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'security.password.changed',
				payload: { via: 'social_login_claim' },
			})
		);
	});

	it('revoga antes de gravar: se revogar falhar, a senha não muda', async () => {
		sessions.revokeAll.mockRejectedValueOnce(new Error('down'));

		await expect(googleLogin(account())).rejects.toThrow('down');

		expect(claimWrite()).toBeUndefined();
	});

	it('abre a sessão normalmente depois de assumir a conta', async () => {
		await expect(googleLogin(account())).resolves.toHaveProperty('accessToken');
	});

	it('conta já verificada não perde a senha', async () => {
		await googleLogin(account({ isEmailVerified: true }));

		expect(sessions.revokeAll).not.toHaveBeenCalled();
		expect(claimWrite()).toBeUndefined();
	});

	it('com 2FA, não mexe na conta e exige o código', async () => {
		const result: any = await googleLogin(account({ twoFactorEnabled: true }));

		expect(result.requiresTwoFactor).toBe(true);
		expect(sessions.revokeAll).not.toHaveBeenCalled();
		const verified = updateOne.mock.calls.some(
			([, update]) => update.$set?.isEmailVerified
		);
		expect(verified).toBe(false);
	});

	it('com 2FA, conta não verificada não vira admin pelo e-mail', async () => {
		const adminPolicy = jest.requireActual(
			'src/admin/application/admin-bootstrap.policy'
		);
		jest.spyOn(adminPolicy, 'isBootstrapAdminEmail').mockReturnValue(true);

		await googleLogin(account({ twoFactorEnabled: true }));

		const promoted = updateOne.mock.calls.some(
			([, update]) => update.$set?.role
		);
		expect(promoted).toBe(false);
		jest.restoreAllMocks();
	});
});
