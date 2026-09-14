import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvestmentPolicyService } from './investment-policy.service';
import {
	DEFAULT_INVESTMENT_POLICY,
	INVESTMENT_POLICY_HISTORY_LIMIT,
	InvestmentPolicy,
} from './domain/investment-policy';

const lean = (value: unknown) => ({
	select: jest
		.fn()
		.mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
});

describe('InvestmentPolicyService', () => {
	const userModel = { findById: jest.fn(), updateOne: jest.fn() };
	const service = new InvestmentPolicyService(userModel as any);

	const policy: InvestmentPolicy = {
		maxAssetWeightPct: 10,
		maxSectorWeightPct: 30,
		fixedIncomeTargetPct: 40,
		brStocksTargetPct: 30,
		maxCryptoPct: 3,
		benchmark: 'CDI',
	};

	beforeEach(() => jest.resetAllMocks());

	it('returns the handoff defaults when the user never saved a policy', async () => {
		userModel.findById.mockReturnValue(lean({}));

		await expect(service.get('u1')).resolves.toEqual({
			policy: DEFAULT_INVESTMENT_POLICY,
			isDefault: true,
			savedAt: null,
		});
	});

	it('throws when the user does not exist', async () => {
		userModel.findById.mockReturnValue(lean(null));

		await expect(service.get('u1')).rejects.toThrow(NotFoundException);
	});

	it('rejects an asset limit above the sector limit without writing', async () => {
		await expect(
			service.save('u1', { ...policy, maxAssetWeightPct: 40 })
		).rejects.toThrow(BadRequestException);
		expect(userModel.updateOne).not.toHaveBeenCalled();
	});

	it('rejects targets that add up to more than 100%', async () => {
		await expect(
			service.save('u1', { ...policy, fixedIncomeTargetPct: 80 })
		).rejects.toThrow(BadRequestException);
	});

	it('first save sets the policy without touching the history', async () => {
		userModel.findById.mockReturnValue(lean({}));

		const result = await service.save('u1', policy);

		expect(result).toMatchObject({ policy, isDefault: false });
		const update = userModel.updateOne.mock.calls[0][1];
		expect(update.$set.investmentPolicy).toMatchObject(policy);
		expect(update.$push).toBeUndefined();
	});

	it('pushes the replaced version to the top of a capped history', async () => {
		const previous = {
			...DEFAULT_INVESTMENT_POLICY,
			savedAt: new Date('2026-01-01'),
		};
		userModel.findById.mockReturnValue(lean({ investmentPolicy: previous }));

		await service.save('u1', policy);

		expect(userModel.updateOne.mock.calls[0][1].$push).toEqual({
			investmentPolicyHistory: {
				$each: [previous],
				$position: 0,
				$slice: INVESTMENT_POLICY_HISTORY_LIMIT,
			},
		});
	});

	it('lists previous versions without leaking extra stored fields', async () => {
		userModel.findById.mockReturnValue(
			lean({
				investmentPolicyHistory: [
					{ ...policy, savedAt: new Date('2026-02-01T00:00:00Z'), extra: 'x' },
				],
			})
		);

		await expect(service.listVersions('u1')).resolves.toEqual([
			{ policy, savedAt: '2026-02-01T00:00:00.000Z' },
		]);
	});
});
