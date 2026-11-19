import { UnauthorizedException } from '@nestjs/common';
import { AuthenticationService } from 'src/authentication/authentication.service';
import { UserModel } from 'src/users/schema/user.model';
import { AppleSigninService } from './apple-signin.service';
import { AppleIdentity } from './ports/apple-identity-verifier.port';

jest.mock('src/users/schema/user.model', () => ({
	UserModel: { findOne: jest.fn(), updateOne: jest.fn() },
}));

describe('AppleSigninService', () => {
	const findOne = UserModel.findOne as jest.Mock;
	const updateOne = UserModel.updateOne as jest.Mock;
	const verifier = { verify: jest.fn() };
	const authentication = {
		completeSocialLogin: jest.fn().mockResolvedValue({ accessToken: 'token' }),
		createSocialUser: jest.fn().mockResolvedValue({ id: 'new-user' }),
		claimUnverifiedAccount: jest.fn().mockResolvedValue(undefined),
	};
	const audit = { emit: jest.fn() };
	const service = new AppleSigninService(
		verifier,
		authentication as unknown as AuthenticationService,
		audit
	);

	const verified: AppleIdentity = {
		sub: 'apple-sub',
		email: 'a@b.com',
		emailVerified: true,
	};

	/** Respostas de `findOne`, em ordem: primeiro por `sub`, depois por e-mail. */
	const mockFound = (...users: (object | null)[]) => {
		for (const user of users) {
			findOne.mockReturnValueOnce({
				select: () => ({ exec: jest.fn().mockResolvedValue(user) }),
			});
		}
	};

	const signin = (extra: object = {}) =>
		service.signin({
			identityToken: 'token',
			keepConnected: false,
			...extra,
		} as any);

	beforeEach(() => {
		jest.clearAllMocks();
		findOne.mockReset();
		updateOne.mockReturnValue({
			exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
		});
		verifier.verify.mockResolvedValue(verified);
	});

	it('entra pela conta ligada ao sub, mesmo sem e-mail no token', async () => {
		verifier.verify.mockResolvedValue({
			sub: 'apple-sub',
			emailVerified: false,
		});
		const user = { id: 'u1' };
		mockFound(user);

		await signin({ keepConnected: true });

		expect(findOne).toHaveBeenCalledWith({ appleSub: 'apple-sub' });
		expect(authentication.completeSocialLogin).toHaveBeenCalledWith(user, {
			keepConnected: true,
			device: undefined,
		});
	});

	it('repassa o nonce para a validação do token', async () => {
		mockFound({ id: 'u1' });

		await signin({ nonce: 'abc' });

		expect(verifier.verify).toHaveBeenCalledWith('token', 'abc');
	});

	it('repassa o aparelho para a sessão', async () => {
		const device = { deviceId: 'd', deviceName: 'iPhone', platform: 'ios' };
		mockFound({ id: 'u1' });

		await signin({ device });

		expect(authentication.completeSocialLogin).toHaveBeenCalledWith(
			{ id: 'u1' },
			expect.objectContaining({ device })
		);
	});

	it('liga o sub à conta que já tem o mesmo e-mail verificado', async () => {
		const user = { _id: 'u1', id: 'u1', isEmailVerified: true };
		mockFound(null, user);

		await signin();

		expect(updateOne).toHaveBeenCalledWith(
			{ _id: 'u1', appleSub: { $exists: false } },
			{ $set: { appleSub: 'apple-sub' } }
		);
		expect(audit.emit).toHaveBeenCalledWith({
			type: 'security.social_account.linked',
			actor: { userId: 'u1' },
			payload: { provider: 'apple' },
		});
		expect(authentication.createSocialUser).not.toHaveBeenCalled();
		expect(authentication.completeSocialLogin).toHaveBeenCalledWith(
			user,
			expect.anything()
		);
	});

	it('conta nunca verificada: tira o acesso de quem a criou antes de ligar', async () => {
		const user = { _id: 'u1', isEmailVerified: false };
		mockFound(null, user);

		await signin();

		expect(authentication.claimUnverifiedAccount).toHaveBeenCalledWith(user);
		expect(updateOne).toHaveBeenCalled();
		expect(
			authentication.claimUnverifiedAccount.mock.invocationCallOrder[0]
		).toBeLessThan(updateOne.mock.invocationCallOrder[0]);
	});

	it('conta verificada não perde a senha ao ligar', async () => {
		mockFound(null, { _id: 'u1', isEmailVerified: true });

		await signin();

		expect(authentication.claimUnverifiedAccount).not.toHaveBeenCalled();
	});

	it('conta nunca verificada com 2FA: recusa sem mexer na conta', async () => {
		mockFound(null, {
			_id: 'u1',
			isEmailVerified: false,
			twoFactorEnabled: true,
		});

		await expect(signin()).rejects.toThrow(UnauthorizedException);

		expect(authentication.claimUnverifiedAccount).not.toHaveBeenCalled();
		expect(updateOne).not.toHaveBeenCalled();
		expect(authentication.completeSocialLogin).not.toHaveBeenCalled();
	});

	it('se outro login ligou antes, recusa em vez de entrar', async () => {
		updateOne.mockReturnValue({
			exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
		});
		mockFound(null, { _id: 'u1', isEmailVerified: true });

		await expect(signin()).rejects.toThrow(UnauthorizedException);

		expect(authentication.completeSocialLogin).not.toHaveBeenCalled();
	});

	it('não troca o Apple ID já ligado à conta', async () => {
		mockFound(null, { _id: 'u1', appleSub: 'other-sub' });

		await expect(signin()).rejects.toThrow(UnauthorizedException);

		expect(updateOne).not.toHaveBeenCalled();
		expect(authentication.completeSocialLogin).not.toHaveBeenCalled();
	});

	it('e-mail não verificado nunca liga conta existente nem cria conta', async () => {
		verifier.verify.mockResolvedValue({ ...verified, emailVerified: false });
		mockFound(null);

		await expect(signin()).rejects.toThrow(UnauthorizedException);

		expect(findOne).toHaveBeenCalledTimes(1);
		expect(authentication.createSocialUser).not.toHaveBeenCalled();
	});

	it('sem conta e sem e-mail no token, recusa', async () => {
		verifier.verify.mockResolvedValue({
			sub: 'apple-sub',
			emailVerified: false,
		});
		mockFound(null);

		await expect(signin()).rejects.toThrow(UnauthorizedException);
	});

	it('cria a conta com o e-mail do token e o nome enviado pelo app', async () => {
		mockFound(null, null);

		await signin({ firstName: ' Ana ', lastName: ' Silva ' });

		expect(authentication.createSocialUser).toHaveBeenCalledWith({
			email: 'a@b.com',
			firstName: 'Ana',
			lastName: 'Silva',
			appleSub: 'apple-sub',
		});
		expect(authentication.completeSocialLogin).toHaveBeenCalledWith(
			{ id: 'new-user' },
			expect.anything()
		);
	});

	it('sem nome, a conta nasce com o nome padrão', async () => {
		mockFound(null, null);

		await signin();

		expect(authentication.createSocialUser).toHaveBeenCalledWith(
			expect.objectContaining({ firstName: 'Usuário', lastName: '' })
		);
	});

	it('token inválido não consulta conta nenhuma', async () => {
		verifier.verify.mockRejectedValue(new UnauthorizedException());

		await expect(signin()).rejects.toThrow(UnauthorizedException);

		expect(findOne).not.toHaveBeenCalled();
	});
});
