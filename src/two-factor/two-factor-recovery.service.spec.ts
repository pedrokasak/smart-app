import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { TwoFactorService } from './two-factor.service';
import { AuthenticationService } from 'src/authentication/authentication.service';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { EmailService } from 'src/notifications/email/email.service';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { UserModel } from 'src/users/schema/user.model';
import {
	StoredRecoveryCode,
	hashRecoveryCode,
} from './security/recovery-codes';
import { MAX_TWO_FACTOR_ATTEMPTS } from './security/two-factor-attempt-policy';

/**
 * `crypto.timingSafeEqual` não é redefinível no Node atual, então `jest.spyOn`
 * lança sobre ele. O envelope mantém a implementação real e serve só para
 * provar que a comparação do código passa por ali.
 */
jest.mock('crypto', () => {
	const actual = jest.requireActual('crypto');
	return {
		...actual,
		timingSafeEqual: jest.fn(actual.timingSafeEqual),
	};
});

jest.mock('src/users/schema/user.model', () => ({
	UserModel: {
		findById: jest.fn(),
		findByIdAndUpdate: jest.fn(),
		updateOne: jest.fn(),
	},
}));

/**
 * Códigos de recuperação do 2FA.
 *
 * Como no spec de TRA-140, o `AuthenticationService` aqui é o real e não um
 * mock: parte do que se verifica é que o login por código de recuperação sai
 * pelo mesmo `issueSessionTokens` do login comum, com o refresh token
 * hasheado do mesmo jeito.
 */
describe('TwoFactorService — códigos de recuperação', () => {
	let service: TwoFactorService;

	const mockJwtService = { sign: jest.fn(), verify: jest.fn() };

	const mockTokenBlacklistService = {
		addToBlacklist: jest.fn().mockResolvedValue(undefined),
		isBlacklisted: jest.fn().mockResolvedValue(false),
	};

	const mockEmailService = { sendPasswordResetEmail: jest.fn() };

	const mockPasswordSecurityService = {
		hashPassword: jest.fn(),
		verifyPassword: jest.fn(),
		needsRehash: jest.fn(),
	};

	const secret = authenticator.generateSecret();

	/** Registra o que foi escrito no usuário, imitando `updateOne`. */
	type UpdateCall = { filter: any; update: any; options?: any };
	let updates: UpdateCall[];

	const buildUser = (overrides: Record<string, any> = {}) => ({
		id: 'u1',
		email: 'user@example.com',
		firstName: 'John',
		lastName: 'Doe',
		role: 'user',
		twoFactorEnabled: true,
		twoFactorSecret: secret,
		refreshToken: null as string | null,
		twoFactorRecoveryCodes: undefined as StoredRecoveryCode[] | undefined,
		twoFactorRecoveryCodesGeneratedAt: null as Date | null,
		save: jest.fn().mockResolvedValue(undefined),
		...overrides,
	});

	/** `findById(...).select(...)` devolvendo sempre o mesmo documento. */
	const givenUser = (user: any) => {
		(UserModel.findById as jest.Mock).mockReturnValue({
			select: jest.fn().mockResolvedValue(user),
		});
		return user;
	};

	beforeEach(async () => {
		updates = [];
		(UserModel.updateOne as jest.Mock).mockImplementation(
			(filter, update, options) => {
				updates.push({ filter, update, options });
				return {
					exec: jest
						.fn()
						.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
				};
			}
		);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TwoFactorService,
				AuthenticationService,
				{ provide: JwtService, useValue: mockJwtService },
				{ provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
				{ provide: EmailService, useValue: mockEmailService },
				{
					provide: PasswordSecurityService,
					useValue: mockPasswordSecurityService,
				},
				// Dublê so para satisfazer a injecao do AuthenticationService real:
				// nenhum caminho de codigo de recuperacao passa pela politica de
				// senha vazada.
				{
					provide: BreachedPasswordPolicy,
					useValue: { assertNotBreached: jest.fn() },
				},
			],
		}).compile();

		service = module.get<TwoFactorService>(TwoFactorService);

		mockJwtService.sign.mockImplementation(
			(payload: { type: string }) => `signed.${payload.type}.token`
		);
		mockJwtService.verify.mockReturnValue({
			userId: 'u1',
			type: 'temp_2fa',
			exp: Math.floor(Date.now() / 1000) + 300,
		});
	});

	afterEach(() => {
		jest.clearAllMocks();
		jest.restoreAllMocks();
		mockTokenBlacklistService.isBlacklisted.mockResolvedValue(false);
	});

	/** O `$set` da geração, extraído da chamada gravada. */
	const generationSet = () =>
		updates.find((call) => call.update?.$set?.twoFactorRecoveryCodes)?.update
			.$set;

	describe('generateRecoveryCodes', () => {
		it('exige um TOTP válido — sessão sozinha não basta', async () => {
			givenUser(buildUser());

			await expect(
				service.generateRecoveryCodes('u1', '000000')
			).rejects.toBeInstanceOf(UnauthorizedException);

			expect(UserModel.updateOne).not.toHaveBeenCalled();
		});

		it('recusa quando o 2FA não está habilitado', async () => {
			givenUser(buildUser({ twoFactorEnabled: false }));

			await expect(
				service.generateRecoveryCodes('u1', authenticator.generate(secret))
			).rejects.toBeInstanceOf(BadRequestException);

			expect(UserModel.updateOne).not.toHaveBeenCalled();
		});

		it('devolve dez códigos em texto puro e grava só os digests', async () => {
			givenUser(buildUser());

			const result = await service.generateRecoveryCodes(
				'u1',
				authenticator.generate(secret)
			);

			expect(result.codes).toHaveLength(10);
			expect(new Date(result.generatedAt).toISOString()).toBe(
				result.generatedAt
			);

			const stored = generationSet().twoFactorRecoveryCodes;
			expect(stored).toHaveLength(10);

			const serialized = JSON.stringify(stored);
			for (const code of result.codes) {
				// O código em texto puro nunca chega ao banco — nem formatado,
				// nem normalizado.
				expect(serialized).not.toContain(code);
				expect(serialized).not.toContain(code.replace('-', ''));
				expect(serialized).toContain(hashRecoveryCode(code));
			}
			expect(stored.every((entry: StoredRecoveryCode) => !entry.usedAt)).toBe(
				true
			);
		});

		it('grava a lista e o carimbo num $set só, para o conjunto trocar de uma vez', async () => {
			givenUser(buildUser());

			await service.generateRecoveryCodes('u1', authenticator.generate(secret));

			// Um único update contendo os dois campos: não existe janela em que
			// o usuário fique sem códigos ou com o carimbo dessincronizado.
			expect(updates).toHaveLength(1);
			expect(Object.keys(generationSet()).sort()).toEqual([
				'twoFactorRecoveryCodes',
				'twoFactorRecoveryCodesGeneratedAt',
			]);
		});

		it('regenerar substitui o conjunto inteiro, não acrescenta ao antigo', async () => {
			const previous = buildUser().twoFactorRecoveryCodes;
			givenUser(
				buildUser({
					twoFactorRecoveryCodes: [
						{ hash: hashRecoveryCode('OLD1-OLD2'), usedAt: null },
					],
					twoFactorRecoveryCodesGeneratedAt: new Date('2020-01-01'),
				})
			);

			const result = await service.generateRecoveryCodes(
				'u1',
				authenticator.generate(secret)
			);

			const stored = generationSet().twoFactorRecoveryCodes;
			expect(stored).toHaveLength(10);
			expect(JSON.stringify(stored)).not.toContain(
				hashRecoveryCode('OLD1-OLD2')
			);
			expect(result.codes).toHaveLength(10);
			expect(previous).toBeUndefined();

			// Substituição, nunca $push/$addToSet: o conjunto antigo deixa de
			// valer no mesmo instante em que o novo passa a valer.
			expect(updates[0].update.$push).toBeUndefined();
			expect(updates[0].update.$addToSet).toBeUndefined();
		});

		it('os códigos saem uma vez só: o service não tem por onde relê-los', async () => {
			const user = givenUser(buildUser());

			const result = await service.generateRecoveryCodes(
				'u1',
				authenticator.generate(secret)
			);

			// O documento passa a ter só os digests; pedir o status depois não
			// devolve nem um caractere do que foi mostrado.
			user.twoFactorRecoveryCodes = generationSet().twoFactorRecoveryCodes;
			user.twoFactorRecoveryCodesGeneratedAt =
				generationSet().twoFactorRecoveryCodesGeneratedAt;

			const status = await service.getRecoveryCodesStatus('u1');
			const serialized = JSON.stringify(status);

			for (const code of result.codes) {
				expect(serialized).not.toContain(code);
				expect(serialized).not.toContain(code.replace('-', ''));
			}
		});
	});

	describe('getRecoveryCodesStatus', () => {
		it('conta total e restantes sem devolver hash', async () => {
			const generatedAt = new Date('2026-02-03T04:05:06.000Z');
			const hashes = ['A1B2-C3D4', 'E5F6-G7H8', 'J9K2-L3M4'].map((code) => ({
				hash: hashRecoveryCode(code),
				usedAt: null as Date | null,
			}));
			hashes[0].usedAt = new Date();

			givenUser(
				buildUser({
					twoFactorRecoveryCodes: hashes,
					twoFactorRecoveryCodesGeneratedAt: generatedAt,
				})
			);

			const status = await service.getRecoveryCodesStatus('u1');

			expect(status).toEqual({
				total: 3,
				remaining: 2,
				generatedAt: '2026-02-03T04:05:06.000Z',
			});

			const serialized = JSON.stringify(status);
			for (const entry of hashes) {
				expect(serialized).not.toContain(entry.hash);
			}
			expect(serialized).not.toMatch(/[0-9a-f]{64}/);
		});

		it('quem nunca gerou vê zero e generatedAt nulo', async () => {
			givenUser(buildUser());

			await expect(service.getRecoveryCodesStatus('u1')).resolves.toEqual({
				total: 0,
				remaining: 0,
				generatedAt: null,
			});
		});
	});

	describe('consumeRecoveryCode', () => {
		const validCode = 'A1B2-C3D4';

		const userWithCodes = (overrides: Record<string, any> = {}) =>
			givenUser(
				buildUser({
					twoFactorRecoveryCodes: [
						{ hash: hashRecoveryCode(validCode), usedAt: null },
						{ hash: hashRecoveryCode('E5F6-G7H8'), usedAt: null },
					],
					twoFactorRecoveryCodesGeneratedAt: new Date(),
					...overrides,
				})
			);

		it('loga o usuário e emite a sessão pelo mesmo issueSessionTokens', async () => {
			const user = userWithCodes();

			const result = await service.consumeRecoveryCode('temp.token', validCode);

			expect(result.accessToken).toBe('signed.access.token');
			expect(result.refreshToken).toBe('signed.refresh.token');
			expect(result.user).toEqual({
				id: 'u1',
				email: 'user@example.com',
				firstName: 'John',
				lastName: 'Doe',
				role: 'user',
			});
			// Mesmo hash SHA-256 do login comum, nunca o token em texto puro.
			expect(user.refreshToken).toBe(
				crypto
					.createHash('sha256')
					.update(result.refreshToken, 'utf8')
					.digest('hex')
			);
			expect(user.save).toHaveBeenCalled();
		});

		it('aceita o código digitado sem hífen e em minúscula', async () => {
			userWithCodes();

			await expect(
				service.consumeRecoveryCode('temp.token', ' a1b2c3d4 ')
			).resolves.toHaveProperty('accessToken');
		});

		it('carimba usedAt com filtro que exige a entrada ainda livre', async () => {
			userWithCodes();

			await service.consumeRecoveryCode('temp.token', validCode);

			const consume = updates.find(
				(call) => call.filter?.twoFactorRecoveryCodes?.$elemMatch
			);
			expect(consume).toBeDefined();
			expect(consume.filter.twoFactorRecoveryCodes.$elemMatch).toEqual({
				hash: hashRecoveryCode(validCode),
				usedAt: null,
			});
			// Carimba, não remove: o uso continua auditável.
			expect(consume.update.$set).toEqual({
				'twoFactorRecoveryCodes.$[entry].usedAt': expect.any(Date),
			});
			expect(consume.update.$pull).toBeUndefined();
			expect(consume.update.$unset).toBeUndefined();
		});

		it('recusa reuso do mesmo código', async () => {
			userWithCodes({
				twoFactorRecoveryCodes: [
					{ hash: hashRecoveryCode(validCode), usedAt: new Date() },
				],
			});

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('recusa o código quando o banco diz que ele já foi gasto na corrida', async () => {
			userWithCodes();
			// O documento lido dizia "livre", mas outra requisição chegou antes:
			// o filtro do update não casa e nada é modificado.
			(UserModel.updateOne as jest.Mock).mockImplementation(
				(filter, update, options) => {
					updates.push({ filter, update, options });
					return {
						exec: jest
							.fn()
							.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
					};
				}
			);

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('recusa código inexistente', async () => {
			userWithCodes();

			await expect(
				service.consumeRecoveryCode('temp.token', 'ZZZZ-ZZZZ')
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('recusa quem nunca gerou códigos', async () => {
			givenUser(buildUser());

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('compara em tempo constante, via crypto.timingSafeEqual', async () => {
			const timingSafeEqual = crypto.timingSafeEqual as unknown as jest.Mock;
			userWithCodes();

			await service.consumeRecoveryCode('temp.token', validCode);

			expect(timingSafeEqual).toHaveBeenCalled();
			for (const call of timingSafeEqual.mock.calls) {
				expect((call[0] as Buffer).length).toBe((call[1] as Buffer).length);
			}
		});

		it('invalida o tempToken depois do sucesso, para não haver replay', async () => {
			userWithCodes();

			await service.consumeRecoveryCode('temp.token', validCode);

			expect(mockTokenBlacklistService.addToBlacklist).toHaveBeenCalledWith(
				'temp.token',
				expect.any(Number)
			);
		});

		it('recusa tempToken já revogado', async () => {
			userWithCodes();
			mockTokenBlacklistService.isBlacklisted.mockResolvedValue(true);

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('recusa token que não é temp_2fa', async () => {
			userWithCodes();
			mockJwtService.verify.mockReturnValue({ userId: 'u1', type: 'access' });

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toBeInstanceOf(UnauthorizedException);
		});

		it('erro aqui alimenta o MESMO contador do TOTP, sem orçamento novo', async () => {
			userWithCodes();

			await expect(
				service.consumeRecoveryCode('temp.token', 'ZZZZ-ZZZZ')
			).rejects.toBeInstanceOf(UnauthorizedException);

			const attempt = updates.find(
				(call) => call.update?.$set?.twoFactorFailedAttempts !== undefined
			);
			expect(attempt.update.$set.twoFactorFailedAttempts).toBe(1);
			expect(attempt.update.$set.twoFactorFirstFailedAttemptAt).toBeInstanceOf(
				Date
			);
		});

		it('continua de onde o TOTP parou: a 5ª falha derruba o tempToken', async () => {
			userWithCodes({
				twoFactorFailedAttempts: MAX_TWO_FACTOR_ATTEMPTS - 1,
				twoFactorFirstFailedAttemptAt: new Date(),
			});

			await expect(
				service.consumeRecoveryCode('temp.token', 'ZZZZ-ZZZZ')
			).rejects.toBeInstanceOf(UnauthorizedException);

			expect(mockTokenBlacklistService.addToBlacklist).toHaveBeenCalledWith(
				'temp.token',
				expect.any(Number)
			);
		});

		it('usuário já bloqueado não consegue tentar um código de recuperação', async () => {
			userWithCodes({
				twoFactorFailedAttempts: MAX_TWO_FACTOR_ATTEMPTS,
				twoFactorFirstFailedAttemptAt: new Date(),
			});

			await expect(
				service.consumeRecoveryCode('temp.token', validCode)
			).rejects.toThrow(
				'Muitas tentativas de verificação. Faça login novamente.'
			);

			// Bloqueado antes de olhar o código: nenhum carimbo de consumo.
			expect(updates.some((call) => call.filter?.twoFactorRecoveryCodes)).toBe(
				false
			);
		});

		it('acerto zera a contagem de tentativas', async () => {
			userWithCodes({
				twoFactorFailedAttempts: 3,
				twoFactorFirstFailedAttemptAt: new Date(),
			});

			await service.consumeRecoveryCode('temp.token', validCode);

			const cleared = updates.find(
				(call) => call.update?.$set?.twoFactorFailedAttempts === 0
			);
			expect(cleared.update.$set.twoFactorFirstFailedAttemptAt).toBeNull();
		});
	});
});
