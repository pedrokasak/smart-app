import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioDigestController } from './portfolio-digest.controller';
import { DigestUnsubscribeTokenService } from './application/digest-unsubscribe-token.service';
import { getModelToken } from '@nestjs/mongoose';

function mockResponse() {
	const res: any = {};
	res.status = jest.fn().mockReturnValue(res);
	res.type = jest.fn().mockReturnValue(res);
	res.send = jest.fn().mockReturnValue(res);
	return res;
}

describe('PortfolioDigestController', () => {
	let controller: PortfolioDigestController;
	const mockTokenService = { verify: jest.fn() };
	const mockUserModel = { findByIdAndUpdate: jest.fn() };

	beforeEach(async () => {
		jest.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PortfolioDigestController],
			providers: [
				{ provide: DigestUnsubscribeTokenService, useValue: mockTokenService },
				{ provide: getModelToken('User'), useValue: mockUserModel },
			],
		}).compile();

		controller = module.get<PortfolioDigestController>(
			PortfolioDigestController
		);
	});

	it('desativa a preferência e responde 200 quando o token é válido', async () => {
		mockTokenService.verify.mockReturnValue({ userId: 'user-123' });
		mockUserModel.findByIdAndUpdate.mockResolvedValue({});
		const res = mockResponse();

		await controller.unsubscribe('valid-token', res);

		expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
			'user-123',
			expect.objectContaining({
				$set: expect.objectContaining({
					'notificationPreferences.portfolioDigest.enabled': false,
				}),
			})
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('responde 400 sem tocar no banco quando o token é inválido', async () => {
		mockTokenService.verify.mockReturnValue(null);
		const res = mockResponse();

		await controller.unsubscribe('bad-token', res);

		expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('trata token ausente como inválido, não como crash', async () => {
		mockTokenService.verify.mockReturnValue(null);
		const res = mockResponse();

		await controller.unsubscribe(undefined as any, res);

		expect(mockTokenService.verify).toHaveBeenCalledWith('');
		expect(res.status).toHaveBeenCalledWith(400);
	});
});
