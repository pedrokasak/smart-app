import mongoose, { Model } from 'mongoose';
import {
	AdvisorPortalGrantDoc,
	advisorPortalGrantSchema,
	PORTAL_GRANT_USER_ACTIVE_INDEX,
} from './advisor-portal-grant.models';
import { MongoPortalGrantStore } from './mongo-portal-grant.store';

/** Sem banco: `findOne` e `create` são substituídos por stubs. */
describe('MongoPortalGrantStore.grant race', () => {
	let model: Model<AdvisorPortalGrantDoc>;
	let store: MongoPortalGrantStore;
	let findOne: jest.SpyInstance;
	let create: jest.SpyInstance;

	const winner: AdvisorPortalGrantDoc = {
		_id: 'g1',
		userId: 'u1',
		grantedBy: 'admin-2',
		grantedAt: new Date('2026-11-20T10:00:00Z'),
		active: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const query = (result: unknown) => ({
		lean: () => ({ exec: () => Promise.resolve(result) }),
	});
	const duplicateOnActiveIndex = () =>
		Object.assign(
			new Error(`E11000 index: ${PORTAL_GRANT_USER_ACTIVE_INDEX}`),
			{
				code: 11000,
			}
		);

	beforeEach(() => {
		model = mongoose.model<AdvisorPortalGrantDoc>(
			`AdvisorPortalGrantStoreSpec${Math.random().toString(36).slice(2)}`,
			advisorPortalGrantSchema
		);
		findOne = jest.spyOn(model, 'findOne');
		create = jest.spyOn(model, 'create');
		store = new MongoPortalGrantStore(model);
	});

	afterEach(() => jest.restoreAllMocks());

	it('losing the insert race returns the grant that won, without the index flag', async () => {
		findOne
			.mockReturnValueOnce(query(null) as never)
			.mockReturnValueOnce(query(winner) as never);
		create.mockRejectedValueOnce(duplicateOnActiveIndex());

		await expect(store.grant('u1', 'admin-1', new Date())).resolves.toEqual({
			id: 'g1',
			userId: 'u1',
			grantedBy: 'admin-2',
			grantedAt: winner.grantedAt,
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('rethrows any other error without retrying', async () => {
		const failure = Object.assign(new Error('E11000 _id_'), { code: 11000 });
		findOne.mockReturnValue(query(null) as never);
		create.mockRejectedValueOnce(failure);

		await expect(store.grant('u1', 'admin-1', new Date())).rejects.toBe(
			failure
		);
		expect(create).toHaveBeenCalledTimes(1);
	});
});
