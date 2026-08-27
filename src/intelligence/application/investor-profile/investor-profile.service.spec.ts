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
			riskTolerance: 'moderate',
			confidence: 1,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.calculateAndPersist('u1');

		expect(result.sophistication).toBe('experienced');
		expect(result.riskTolerance).toBe('moderate');
		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: expect.objectContaining({
					sophistication: 'experienced',
					// riskTolerance nunca e 'aggressive' hoje: sem tipo de renda
					// fixa no schema de Asset, 100% de renda variavel e capado em
					// 'moderate' (ver computeRiskTolerance).
					riskTolerance: 'moderate',
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
		(InvestorProfileModel.findOne as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});
		(InvestorProfileModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'user_override',
			overriddenSophistication: 'experienced',
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.setOverride('u1', { sophistication: 'experienced' });

		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: expect.objectContaining({
					overriddenSophistication: 'experienced',
					source: 'user_override',
				}),
			},
			expect.objectContaining({ upsert: true })
		);
		expect(result.sophistication).toBe('experienced');
		expect(result.source).toBe('user_override');
	});

	it('setOverride cria documento base quando nenhum calculateAndPersist rodou antes (finding #3)', async () => {
		(InvestorProfileModel.findOne as jest.Mock)
			.mockResolvedValueOnce(null) // primeira checagem: nao existe documento
			.mockResolvedValueOnce({
				userId: 'u1',
				sophistication: 'beginner',
				riskTolerance: 'conservative',
				confidence: 0.1,
				signals: {},
				source: 'inferred',
				overriddenSophistication: null,
				overriddenRiskTolerance: null,
			}); // segunda checagem: apos calculateAndPersist criar a linha de base

		userModel.findById.mockResolvedValue({ _id: 'u1', createdAt: new Date() });
		portfolioService.getUserPortfolios.mockResolvedValue([]);
		(TradeModel.countDocuments as jest.Mock).mockResolvedValue(0);

		(InvestorProfileModel.findOneAndUpdate as jest.Mock)
			.mockResolvedValueOnce({
				userId: 'u1',
				sophistication: 'beginner',
				riskTolerance: 'conservative',
				confidence: 0.1,
				signals: {},
				source: 'inferred',
				overriddenSophistication: null,
				overriddenRiskTolerance: null,
			}) // resultado do calculateAndPersist (baseline)
			.mockResolvedValueOnce({
				userId: 'u1',
				sophistication: 'beginner',
				riskTolerance: 'conservative',
				confidence: 0.1,
				signals: {},
				source: 'user_override',
				overriddenSophistication: 'experienced',
				overriddenRiskTolerance: null,
			}); // resultado do setOverride em si

		const service = makeService();
		const result = await service.setOverride('u1', { sophistication: 'experienced' });

		// calculateAndPersist rodou para estabelecer a linha de base antes do override.
		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
		expect(result.sophistication).toBe('experienced');
		expect(result.confidence).toBe(0.1);
		expect(result.riskTolerance).toBe('conservative');
	});

	it('setOverride com null reseta o override e getEffectiveProfile volta ao valor inferido (finding #4)', async () => {
		(InvestorProfileModel.findOne as jest.Mock).mockResolvedValueOnce({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'user_override',
			overriddenSophistication: 'experienced',
			overriddenRiskTolerance: null,
		});
		(InvestorProfileModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});

		const service = makeService();
		const result = await service.setOverride('u1', { sophistication: null });

		expect(InvestorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: expect.objectContaining({
					overriddenSophistication: null,
					source: 'inferred',
				}),
			},
			expect.objectContaining({ upsert: true })
		);
		expect(result.sophistication).toBe('intermediate');
		expect(result.source).toBe('inferred');

		(InvestorProfileModel.findOne as jest.Mock).mockResolvedValueOnce({
			userId: 'u1',
			sophistication: 'intermediate',
			riskTolerance: 'moderate',
			confidence: 0.7,
			signals: {},
			source: 'inferred',
			overriddenSophistication: null,
			overriddenRiskTolerance: null,
		});
		const effective = await service.getEffectiveProfile('u1');
		expect(effective.sophistication).toBe('intermediate');
		expect(effective.source).toBe('inferred');
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
