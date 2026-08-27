import { InvestorProfileScheduler } from './investor-profile.scheduler';

describe('InvestorProfileScheduler', () => {
	it('recalcula o perfil de todos os usuarios, isolando falhas individuais', async () => {
		const userModel = {
			find: jest.fn().mockResolvedValue([{ _id: 'u1' }, { _id: 'u2' }]),
		} as any;
		const investorProfileService = {
			calculateAndPersist: jest
				.fn()
				.mockResolvedValueOnce({ sophistication: 'experienced' })
				.mockRejectedValueOnce(new Error('boom')),
		} as any;

		const scheduler = new InvestorProfileScheduler(
			userModel,
			investorProfileService
		);
		await scheduler.recalculateDaily();

		expect(investorProfileService.calculateAndPersist).toHaveBeenCalledTimes(2);
		expect(investorProfileService.calculateAndPersist).toHaveBeenCalledWith('u1');
		expect(investorProfileService.calculateAndPersist).toHaveBeenCalledWith('u2');
	});
});
