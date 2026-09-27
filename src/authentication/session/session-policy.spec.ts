import {
	REFRESH_ROTATION_GRACE_MS,
	isWithinRotationGrace,
	remainingSessionSeconds,
	sessionTtl,
} from './session-policy';

describe('session-policy (TRA-245)', () => {
	it('escolhe o prazo pela opção "Manter conectado"', () => {
		expect(sessionTtl(false)).toBe('1d');
		expect(sessionTtl(true)).toBe('30d');
	});

	it('calcula o que falta da sessão, nunca menos de 1 segundo', () => {
		const now = 1_000_000_000_000;
		expect(remainingSessionSeconds(now / 1000 + 90, now)).toBe(90);
		expect(remainingSessionSeconds(now / 1000 - 10, now)).toBe(1);
	});

	it('aceita o token anterior só dentro da janela de tolerância', () => {
		const now = Date.now();
		expect(isWithinRotationGrace(new Date(now - 1000), now)).toBe(true);
		expect(
			isWithinRotationGrace(new Date(now - REFRESH_ROTATION_GRACE_MS - 1), now)
		).toBe(false);
		expect(isWithinRotationGrace(null, now)).toBe(false);
	});
});
