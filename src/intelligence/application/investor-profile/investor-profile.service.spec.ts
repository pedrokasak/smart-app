import { InvestorProfileService } from './investor-profile.service';
import { InvestorProfileModel } from './schema/investor-profile.model';
import { TradeModel } from 'src/fiscal/schema/trade.model';

jest.mock('./schema/investor-profile.model');
jest.mock('src/fiscal/schema/trade.model');

describe('InvestorProfileService', () => {
	const userModel = {
		findById: jest.fn(),
	} as any;
	const portfolioService = {
		getUserPortfolios: jest.fn(),
	} as any;

	const makeService = () =>
		new InvestorProfileService(userModel, portfolioService);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('calcula perfil experienced para carteira diversificada com giro alto', async () => {
		userModel.findById.mockResolvedValue({
			_id: 'u1',
			createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
		});
		portfolioService.getUserPortfolios.mockResolvedValue([
			{
				assets: [
					{ symbol: 'PETR4', type: 'stock', sector: 'ENERGY', total: 1000 },
					{ symbol: 'ITUB4', type: 'stock', sector: 'FINANCIAL', total: 1000 },
					{ symbol: 'WEGE3', type: 'stock', sector: 'INDUSTRIAL', total: 1000 },
				],
			},
		]);
		(TradeModel.countDocuments as jest.Mock).mockResolvedValue(20);
		(InvestorProfileModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'experienced',
			riskTolerance: 'aggressive',
			confidence: 1,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.calculateAndPersist('u1');

		expect(result.sophistication).toBe('experienced');
		expect(result.riskTolerance).toBe('aggressive');
		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: expect.objectContaining({
					sophistication: 'experienced',
					riskTolerance: 'aggressive',
				}),
			},
			expect.objectContaining({ upsert: true })
		);
	});

	it('override do usuario prevalece sobre o valor inferido em getEffectiveProfile', async () => {
		(InvestorProfileModel.findOne as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'inferred',
			overriddenSophistication: 'experienced',
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.getEffectiveProfile('u1');

		expect(result.sophistication).toBe('experienced');
		expect(result.riskTolerance).toBe('moderate');
		expect(result.source).toBe('user_override');
	});

	it('setOverride grava o campo overridden e nao apaga o inferido', async () => {
		(InvestorProfileModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'inferred',
			overriddenSophistication: 'experienced',
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.setOverride('u1', { sophistication: 'experienced' });

		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: expect.objectContaining({ overriddenSophistication: 'experienced' }),
			},
			expect.objectContaining({ upsert: true })
		);
		expect(result.sophistication).toBe('experienced');
		expect(result.source).toBe('user_override');
	});

	it('getEffectiveProfile calcula na hora quando nao ha documento persistido', async () => {
		(InvestorProfileModel.findOne as jest.Mock).mockResolvedValue(null);
		userModel.findById.mockResolvedValue({
			_id: 'u1',
			createdAt: new Date(),
		});
		portfolioService.getUserPortfolios.mockResolvedValue([]);
		(TradeModel.countDocuments as jest.Mock).mockResolvedValue(0);
		(InvestorProfileModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'beginner',
			riskTolerance: 'conservative',
			confidence: 0.1,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.getEffectiveProfile('u1');

		expect(result.sophistication).toBe('beginner');
		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalled();
	});
});
