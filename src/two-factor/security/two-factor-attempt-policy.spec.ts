import {
	MAX_TWO_FACTOR_ATTEMPTS,
	TWO_FACTOR_ATTEMPT_WINDOW_MS,
	clearedAttemptState,
	hasReachedLimit,
	isTwoFactorBlocked,
	readAttemptState,
	registerFailedAttempt,
} from './two-factor-attempt-policy';

describe('two-factor attempt policy', () => {
	const now = new Date('2026-01-01T12:00:00.000Z');
	const ago = (ms: number) => new Date(now.getTime() - ms);

	describe('readAttemptState', () => {
		it('treats a document without the fields as "never failed"', () => {
			expect(readAttemptState({})).toEqual({
				failedAttempts: 0,
				firstFailedAttemptAt: null,
			});
		});

		it('never produces NaN from a corrupted counter', () => {
			const state = readAttemptState({
				twoFactorFailedAttempts: undefined,
				twoFactorFirstFailedAttemptAt: null,
			});
			expect(state.failedAttempts).toBe(0);
		});
	});

	describe('isTwoFactorBlocked', () => {
		it('does not block below the threshold', () => {
			const state = {
				failedAttempts: MAX_TWO_FACTOR_ATTEMPTS - 1,
				firstFailedAttemptAt: ago(1000),
			};
			expect(isTwoFactorBlocked(state, now)).toBe(false);
		});

		it('blocks at the threshold, inside the window', () => {
			const state = {
				failedAttempts: MAX_TWO_FACTOR_ATTEMPTS,
				firstFailedAttemptAt: ago(1000),
			};
			expect(isTwoFactorBlocked(state, now)).toBe(true);
		});

		it('stops blocking once the window has elapsed', () => {
			const state = {
				failedAttempts: MAX_TWO_FACTOR_ATTEMPTS + 10,
				firstFailedAttemptAt: ago(TWO_FACTOR_ATTEMPT_WINDOW_MS + 1),
			};
			expect(isTwoFactorBlocked(state, now)).toBe(false);
		});

		it('never blocks a state that has no failures recorded', () => {
			expect(isTwoFactorBlocked(clearedAttemptState(), now)).toBe(false);
		});
	});

	describe('registerFailedAttempt', () => {
		it('opens a new window on the first failure', () => {
			expect(registerFailedAttempt(clearedAttemptState(), now)).toEqual({
				failedAttempts: 1,
				firstFailedAttemptAt: now,
			});
		});

		it('increments inside the window and keeps the ORIGINAL timestamp', () => {
			// Se o carimbo andasse a cada erro, a janela nunca terminaria e o
			// limite nunca fecharia — o bug classico deste tipo de contador.
			const opened = ago(60 * 1000);
			const next = registerFailedAttempt(
				{ failedAttempts: 2, firstFailedAttemptAt: opened },
				now
			);
			expect(next).toEqual({ failedAttempts: 3, firstFailedAttemptAt: opened });
		});

		it('restarts the count when the previous window has expired', () => {
			const next = registerFailedAttempt(
				{
					failedAttempts: 9,
					firstFailedAttemptAt: ago(TWO_FACTOR_ATTEMPT_WINDOW_MS + 1),
				},
				now
			);
			expect(next).toEqual({ failedAttempts: 1, firstFailedAttemptAt: now });
		});

		it('reaches the limit after exactly MAX consecutive failures', () => {
			let state = clearedAttemptState();
			for (let i = 0; i < MAX_TWO_FACTOR_ATTEMPTS - 1; i += 1) {
				state = registerFailedAttempt(state, now);
				expect(hasReachedLimit(state)).toBe(false);
			}
			state = registerFailedAttempt(state, now);
			expect(hasReachedLimit(state)).toBe(true);
		});
	});
});
