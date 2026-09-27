import { Types } from 'mongoose';
import { ProfileEmailOptOutAdapter } from './profile-email-opt-out.adapter';

describe('ProfileEmailOptOutAdapter (TRA-244)', () => {
	const findOne = jest.fn();
	const adapter = new ProfileEmailOptOutAdapter({ findOne } as never);
	const userId = new Types.ObjectId();

	const profileReturns = (value: unknown) =>
		findOne.mockReturnValue({
			select: () => ({ lean: () => Promise.resolve(value) }),
		});

	afterEach(() => jest.clearAllMocks());

	it('desligado no perfil: optou por sair', async () => {
		profileReturns({ preferences: { notifications: false } });
		await expect(adapter.hasOptedOut(userId)).resolves.toBe(true);
		expect(findOne).toHaveBeenCalledWith({ user: userId });
	});

	it('ligado, ausente ou sem perfil: segue recebendo', async () => {
		for (const profile of [
			{ preferences: { notifications: true } },
			{ preferences: {} },
			null,
		]) {
			profileReturns(profile);
			await expect(adapter.hasOptedOut(userId)).resolves.toBe(false);
		}
	});

	it('falha ao ler a preferência: não manda', async () => {
		findOne.mockReturnValue({
			select: () => ({ lean: () => Promise.reject(new Error('mongo fora')) }),
		});
		await expect(adapter.hasOptedOut(userId)).resolves.toBe(true);
	});
});
