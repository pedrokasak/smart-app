import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';

describe('UsersService.markEmailVerified', () => {
	const service = new UsersService(
		{} as any,
		{} as any,
		{} as any,
		{} as any,
		{} as any
	);

	afterEach(() => jest.restoreAllMocks());

	it('filters by id, e-mail and not-yet-verified in one update', async () => {
		const update = jest
			.spyOn(UserModel, 'findOneAndUpdate')
			.mockResolvedValue({ _id: 'u1' } as any);

		expect(await service.markEmailVerified('u1', 'a@exemplo.com')).toBe(true);

		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith(
			{ _id: 'u1', email: 'a@exemplo.com', isEmailVerified: { $ne: true } },
			{ $set: { isEmailVerified: true } }
		);
	});

	it('returns false when nothing matched', async () => {
		jest.spyOn(UserModel, 'findOneAndUpdate').mockResolvedValue(null as any);

		expect(await service.markEmailVerified('u1', 'a@exemplo.com')).toBe(false);
	});
});
