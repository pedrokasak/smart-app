import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { PortfolioDigestController } from './portfolio-digest.controller';
import { DigestUnsubscribeTokenService } from './application/digest-unsubscribe-token.service';
import { getModelToken } from '@nestjs/mongoose';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

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
	const mockUserModel = {
		findByIdAndUpdate: jest.fn(),
		findById: jest.fn(),
	};

	beforeEach(async () => {
		jest.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PortfolioDigestController],
			providers: [
				{ provide: DigestUnsubscribeTokenService, useValue: mockTokenService },
				{ provide: getModelToken('User'), useValue: mockUserModel },
				// @UseGuards(JwtAuthGuard) nas rotas novas (TRA-202) faz o Nest
				// resolver as dependencias do guard ja na montagem do modulo,
				// mesmo sem a rota ser chamada.
				{ provide: JwtService, useValue: {} },
				{ provide: Reflector, useValue: new Reflector() },
				{
					provide: TokenBlacklistService,
					useValue: { isBlacklisted: jest.fn() },
				},
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

	// TRA-202: antes destas duas rotas, não existia NENHUM jeito de ligar o
	// digest — só o unsubscribe (desligar). Cobrem exatamente o que faltava.
	describe('GET/PATCH preferences (TRA-202)', () => {
		const req = { user: { userId: 'user-123' } };

		it('getPreference devolve false quando o usuário nunca configurou nada', async () => {
			mockUserModel.findById.mockReturnValue({
				select: jest
					.fn()
					.mockResolvedValue({ notificationPreferences: undefined }),
			});

			await expect(controller.getPreference(req)).resolves.toEqual({
				enabled: false,
			});
		});

		it('getPreference reflete o valor gravado', async () => {
			mockUserModel.findById.mockReturnValue({
				select: jest.fn().mockResolvedValue({
					notificationPreferences: { portfolioDigest: { enabled: true } },
				}),
			});

			await expect(controller.getPreference(req)).resolves.toEqual({
				enabled: true,
			});
		});

		it('updatePreference liga o digest — a rota que nunca existiu', async () => {
			mockUserModel.findByIdAndUpdate.mockResolvedValue({});

			const result = await controller.updatePreference(req, { enabled: true });

			expect(result).toEqual({ enabled: true });
			expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
				'user-123',
				expect.objectContaining({
					$set: expect.objectContaining({
						'notificationPreferences.portfolioDigest.enabled': true,
					}),
				})
			);
		});

		it('updatePreference desliga do mesmo jeito que o unsubscribe faria', async () => {
			mockUserModel.findByIdAndUpdate.mockResolvedValue({});

			await controller.updatePreference(req, { enabled: false });

			expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
				'user-123',
				expect.objectContaining({
					$set: expect.objectContaining({
						'notificationPreferences.portfolioDigest.enabled': false,
					}),
				})
			);
		});

		it('resolve o userId do JWT em qualquer formato já emitido (sub)', async () => {
			mockUserModel.findByIdAndUpdate.mockResolvedValue({});

			await controller.updatePreference(
				{ user: { sub: 'user-456' } },
				{
					enabled: true,
				}
			);

			expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
				'user-456',
				expect.anything()
			);
		});
	});
});
