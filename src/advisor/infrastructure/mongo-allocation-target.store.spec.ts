import mongoose, { Model } from 'mongoose';
import { AssetClass } from '../domain/enums';
import {
	advisorPortfolioSchemas,
	AdvisorAllocationTargetDoc,
} from './advisor-portfolio.models';
import { MongoAllocationTargetStore } from './mongo-allocation-target.store';

/** Sem banco: `findOneAndUpdate` é substituído por um stub. */
describe('MongoAllocationTargetStore.upsert retry', () => {
	let model: Model<AdvisorAllocationTargetDoc>;
	let store: MongoAllocationTargetStore;
	let findOneAndUpdate: jest.SpyInstance;

	const target = {
		orgId: 'o',
		clientProfileId: 'c',
		targets: { [AssetClass.Stock]: 100 },
		updatedByUserId: 'u1',
	};
	const saved = { ...target, _id: 'id', updatedAt: new Date() };
	const query = (result: () => Promise<unknown>) => ({
		lean: () => ({ exec: result }),
	});
	const duplicate = () => Object.assign(new Error('E11000'), { code: 11000 });

	beforeEach(() => {
		model = mongoose.model<AdvisorAllocationTargetDoc>(
			`AdvisorTargetStoreSpec${Math.random().toString(36).slice(2)}`,
			advisorPortfolioSchemas.allocationTarget
		);
		findOneAndUpdate = jest.spyOn(model, 'findOneAndUpdate');
		store = new MongoAllocationTargetStore(model);
	});

	afterEach(() => jest.restoreAllMocks());

	it('retries once after a duplicate-key error and resolves', async () => {
		findOneAndUpdate
			.mockReturnValueOnce(query(() => Promise.reject(duplicate())) as never)
			.mockReturnValueOnce(query(() => Promise.resolve(saved)) as never);

		await expect(store.upsert(target)).resolves.toMatchObject({
			orgId: 'o',
			clientProfileId: 'c',
			targets: { [AssetClass.Stock]: 100 },
		});
		expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
	});

	it('rethrows a non-11000 error without retrying', async () => {
		const failure = new Error('boom');
		findOneAndUpdate.mockReturnValue(
			query(() => Promise.reject(failure)) as never
		);

		await expect(store.upsert(target)).rejects.toBe(failure);
		expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
	});

	it('rethrows a second duplicate-key error (only one retry)', async () => {
		const second = duplicate();
		findOneAndUpdate
			.mockReturnValueOnce(query(() => Promise.reject(duplicate())) as never)
			.mockReturnValueOnce(query(() => Promise.reject(second)) as never);

		await expect(store.upsert(target)).rejects.toBe(second);
		expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
	});
});
