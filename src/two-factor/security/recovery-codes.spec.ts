import * as crypto from 'crypto';
import {
	RECOVERY_CODE_COUNT,
	RECOVERY_CODE_LENGTH,
	findUsableRecoveryCodeHash,
	generateRecoveryCodes,
	hashRecoveryCode,
	normalizeRecoveryCode,
	summarizeRecoveryCodes,
	toStoredRecoveryCodes,
} from './recovery-codes';

/**
 * `crypto.timingSafeEqual` não é redefinível no Node atual, então `jest.spyOn`
 * sobre ele lança. Envolvê-lo aqui, mantendo a implementação real, é o que
 * permite provar que a comparação de digests passa por ele — e é essa a prova
 * que importa: um `===` sobre digests vaza, pelo tempo, quantos caracteres já
 * batem, o que basta para reconstruir o alvo caractere a caractere.
 */
jest.mock('crypto', () => {
	const actual = jest.requireActual('crypto');
	return {
		...actual,
		timingSafeEqual: jest.fn(actual.timingSafeEqual),
	};
});

const timingSafeEqual = crypto.timingSafeEqual as unknown as jest.Mock;

const sha256 = (value: string) =>
	crypto.createHash('sha256').update(value, 'utf8').digest('hex');

describe('recovery-codes (unidade pura)', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('generateRecoveryCodes', () => {
		it('emite dez códigos formatados para leitura', () => {
			const codes = generateRecoveryCodes();

			expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
			for (const code of codes) {
				expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
			}
		});

		it('não usa os caracteres ambíguos I, O, 0 e 1', () => {
			// Amostra grande o bastante para que a ausência não seja sorte.
			const codes = generateRecoveryCodes(200);

			expect(codes.join('')).not.toMatch(/[IO01]/);
		});

		it('tira cada caractere de crypto.randomBytes, não de Math.random', () => {
			const randomBytes = jest
				.fn()
				.mockReturnValue(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));

			const [code] = generateRecoveryCodes(1, randomBytes);

			expect(randomBytes).toHaveBeenCalledWith(RECOVERY_CODE_LENGTH);
			expect(code).toBe('ABCD-EFGH');
		});

		it('não repete códigos dentro do mesmo conjunto', () => {
			const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);

			expect(new Set(codes).size).toBe(codes.length);
		});
	});

	describe('normalizeRecoveryCode', () => {
		it('ignora caixa, separadores e espaços', () => {
			expect(normalizeRecoveryCode(' a1b2-c3d4 ')).toBe('A1B2C3D4');
			expect(normalizeRecoveryCode('A1B2 C3D4')).toBe('A1B2C3D4');
			expect(normalizeRecoveryCode('a1b2c3d4')).toBe('A1B2C3D4');
		});

		it('devolve string vazia para entrada que não é texto', () => {
			expect(normalizeRecoveryCode(undefined as unknown as string)).toBe('');
			expect(normalizeRecoveryCode(null as unknown as string)).toBe('');
		});
	});

	describe('hashRecoveryCode', () => {
		it('é o SHA-256 da forma normalizada, não do texto exibido', () => {
			expect(hashRecoveryCode('A1B2-C3D4')).toBe(sha256('A1B2C3D4'));
			expect(hashRecoveryCode('a1b2c3d4')).toBe(sha256('A1B2C3D4'));
		});

		it('não é Argon2 nem bcrypt: é um digest hex de 64 caracteres', () => {
			// A verificação percorre a lista inteira; um KDF de senha aqui
			// custaria 10x64 MiB por tentativa em um endpoint sem guard.
			expect(hashRecoveryCode('A1B2-C3D4')).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('findUsableRecoveryCodeHash', () => {
		const codes = ['A1B2-C3D4', 'E5F6-G7H8', 'J9K2-L3M4'];
		const stored = toStoredRecoveryCodes(codes);

		it('encontra o código válido escrito de qualquer jeito', () => {
			expect(findUsableRecoveryCodeHash(stored, 'e5f6g7h8')).toBe(
				hashRecoveryCode('E5F6-G7H8')
			);
		});

		it('recusa código que não está na lista', () => {
			expect(findUsableRecoveryCodeHash(stored, 'ZZZZ-ZZZZ')).toBeNull();
		});

		it('recusa código já consumido', () => {
			const consumed = toStoredRecoveryCodes(codes).map((entry, index) =>
				index === 0 ? { ...entry, usedAt: new Date() } : entry
			);

			expect(findUsableRecoveryCodeHash(consumed, 'A1B2-C3D4')).toBeNull();
			expect(findUsableRecoveryCodeHash(consumed, 'E5F6-G7H8')).not.toBeNull();
		});

		it('recusa entrada vazia e lista ausente', () => {
			expect(findUsableRecoveryCodeHash(stored, '')).toBeNull();
			expect(findUsableRecoveryCodeHash(stored, '---')).toBeNull();
			expect(
				findUsableRecoveryCodeHash(
					undefined as unknown as typeof stored,
					'A1B2-C3D4'
				)
			).toBeNull();
		});

		it('compara com crypto.timingSafeEqual, nunca com === sobre o digest', () => {
			findUsableRecoveryCodeHash(stored, 'A1B2-C3D4');

			expect(timingSafeEqual).toHaveBeenCalled();
			// O comprimento é conferido antes: `timingSafeEqual` lança com
			// buffers de tamanhos diferentes.
			for (const call of timingSafeEqual.mock.calls) {
				expect((call[0] as Buffer).length).toBe((call[1] as Buffer).length);
			}
		});

		it('percorre a lista inteira mesmo depois de achar, para não vazar a posição', () => {
			// O primeiro código casa; sair cedo faria uma comparação só, e o
			// tempo de resposta passaria a dizer em que posição o código está.
			findUsableRecoveryCodeHash(stored, 'A1B2-C3D4');

			expect(timingSafeEqual).toHaveBeenCalledTimes(stored.length);
		});
	});

	describe('summarizeRecoveryCodes', () => {
		it('conta o que resta sem devolver hash nem código', () => {
			const generatedAt = new Date('2026-01-02T03:04:05.000Z');
			const stored = toStoredRecoveryCodes(
				generateRecoveryCodes(RECOVERY_CODE_COUNT)
			);
			stored[0].usedAt = new Date();
			stored[1].usedAt = new Date();
			stored[2].usedAt = new Date();

			const summary = summarizeRecoveryCodes(stored, generatedAt);

			expect(summary).toEqual({
				total: 10,
				remaining: 7,
				generatedAt: '2026-01-02T03:04:05.000Z',
			});
			expect(JSON.stringify(summary)).not.toContain(stored[0].hash);
		});

		it('trata "nunca gerou" sem quebrar', () => {
			expect(summarizeRecoveryCodes(undefined, undefined)).toEqual({
				total: 0,
				remaining: 0,
				generatedAt: null,
			});
		});
	});
});
