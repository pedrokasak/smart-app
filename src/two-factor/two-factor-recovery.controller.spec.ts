import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';

jest.mock('src/authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: class JwtAuthGuard {},
}));

const mockTwoFactorService = {
	generateRecoveryCodes: jest.fn(),
	getRecoveryCodesStatus: jest.fn(),
	consumeRecoveryCode: jest.fn(),
};

const guardsOf = (handler: unknown) =>
	Reflect.getMetadata('__guards__', handler as object) ?? [];

/**
 * O contrato destas três rotas é consumido pelo `web` em paralelo, então o
 * caminho e a presença (ou ausência deliberada) do guard são asserção, não
 * detalhe de implementação.
 */
describe('TwoFactorController — códigos de recuperação', () => {
	let controller: TwoFactorController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [TwoFactorController],
			providers: [
				{ provide: TwoFactorService, useValue: mockTwoFactorService },
			],
		}).compile();

		controller = module.get<TwoFactorController>(TwoFactorController);
	});

	afterEach(() => jest.clearAllMocks());

	it('expõe as rotas nos caminhos combinados', () => {
		const prototype = TwoFactorController.prototype;

		expect(Reflect.getMetadata(PATH_METADATA, TwoFactorController)).toBe(
			'auth/2fa'
		);
		expect(
			Reflect.getMetadata(PATH_METADATA, prototype.generateRecoveryCodes)
		).toBe('recovery-codes/generate');
		expect(
			Reflect.getMetadata(METHOD_METADATA, prototype.generateRecoveryCodes)
		).toBe(RequestMethod.POST);
		expect(
			Reflect.getMetadata(PATH_METADATA, prototype.recoveryCodesStatus)
		).toBe('recovery-codes/status');
		expect(
			Reflect.getMetadata(METHOD_METADATA, prototype.recoveryCodesStatus)
		).toBe(RequestMethod.GET);
		expect(
			Reflect.getMetadata(PATH_METADATA, prototype.consumeRecoveryCode)
		).toBe('recovery-codes/consume');
		expect(
			Reflect.getMetadata(METHOD_METADATA, prototype.consumeRecoveryCode)
		).toBe(RequestMethod.POST);
	});

	it('protege geração e status com JwtAuthGuard', () => {
		expect(
			guardsOf(TwoFactorController.prototype.generateRecoveryCodes)
		).toEqual([JwtAuthGuard]);
		expect(guardsOf(TwoFactorController.prototype.recoveryCodesStatus)).toEqual(
			[JwtAuthGuard]
		);
	});

	it('deixa o consumo sem guard, como /auth/2fa/authenticate', () => {
		// Quem perdeu o autenticador só tem o tempToken; exigir JWT aqui
		// tornaria a rota inútil justamente para quem ela existe.
		expect(guardsOf(TwoFactorController.prototype.consumeRecoveryCode)).toEqual(
			[]
		);
		expect(guardsOf(TwoFactorController.prototype.authenticate)).toEqual([]);
	});

	it('generate() repassa o userId do JWT e o código TOTP', async () => {
		const payload = { codes: ['A1B2-C3D4'], generatedAt: 'iso' };
		mockTwoFactorService.generateRecoveryCodes.mockResolvedValue(payload);

		const result = await controller.generateRecoveryCodes(
			{ user: { userId: 'user123' } },
			{ code: '123456' }
		);

		expect(mockTwoFactorService.generateRecoveryCodes).toHaveBeenCalledWith(
			'user123',
			'123456'
		);
		expect(result).toEqual(payload);
	});

	it('status() repassa só o userId', async () => {
		const payload = { total: 10, remaining: 7, generatedAt: 'iso' };
		mockTwoFactorService.getRecoveryCodesStatus.mockResolvedValue(payload);

		const result = await controller.recoveryCodesStatus({
			user: { userId: 'user123' },
		});

		expect(mockTwoFactorService.getRecoveryCodesStatus).toHaveBeenCalledWith(
			'user123'
		);
		expect(result).toEqual(payload);
	});

	it('consume() repassa tempToken e recoveryCode', async () => {
		const tokens = { accessToken: 'acc', refreshToken: 'ref', expiresIn: '1d' };
		mockTwoFactorService.consumeRecoveryCode.mockResolvedValue(tokens);

		const result = await controller.consumeRecoveryCode({
			tempToken: 'tmp123',
			recoveryCode: 'A1B2-C3D4',
		});

		expect(mockTwoFactorService.consumeRecoveryCode).toHaveBeenCalledWith(
			'tmp123',
			'A1B2-C3D4'
		);
		expect(result).toEqual(tokens);
	});
});
