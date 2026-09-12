/**
 * Politica de anti-automacao da verificacao TOTP (TRA-140).
 *
 * `POST /auth/2fa/authenticate` nao tem guard — por desenho, porque nesse
 * ponto o usuario so tem o `tempToken`. Sem contagem de tentativas, isso e um
 * espaco de 6 digitos aberto a repeticao ilimitada dentro da janela de 5
 * minutos do tempToken, ainda por cima com a janela de tolerancia do otplib
 * ampliando os codigos aceitos a cada instante. OWASP ASVS 5.0 6.3.1 exige
 * controle de automacao aqui.
 *
 * Este modulo e deliberadamente PURO: recebe o estado, o relogio, e devolve o
 * proximo estado ou um veredito. Nao conhece Mongoose, Nest nem HTTP, entao a
 * regra pode ser testada sozinha e o service cuida so da persistencia.
 *
 * A contagem e por usuario, nao por tempToken: limitar so por token nao
 * atrapalha ninguem — bastaria pedir um tempToken novo e recomecar do zero.
 * A janela deslizante evita bloqueio permanente: quem errou ha muito tempo
 * comeca a contagem de novo.
 */

/** Tentativas erradas toleradas dentro da janela antes do bloqueio. */
export const MAX_TWO_FACTOR_ATTEMPTS = 5;

/** Janela deslizante da contagem. */
export const TWO_FACTOR_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface TwoFactorAttemptState {
	failedAttempts: number;
	firstFailedAttemptAt: Date | null;
}

/** Estado de quem nunca errou — tambem o estado apos um acerto. */
export function clearedAttemptState(): TwoFactorAttemptState {
	return { failedAttempts: 0, firstFailedAttemptAt: null };
}

/**
 * Normaliza o que veio do banco. Documentos anteriores a esta mudanca nao tem
 * os campos, e ausencia significa "nunca errou" — nao pode virar NaN nem
 * bloquear ninguem.
 */
export function readAttemptState(source: {
	twoFactorFailedAttempts?: number | null;
	twoFactorFirstFailedAttemptAt?: Date | null;
}): TwoFactorAttemptState {
	const failedAttempts = Number(source?.twoFactorFailedAttempts ?? 0);

	return {
		failedAttempts: Number.isFinite(failedAttempts) ? failedAttempts : 0,
		firstFailedAttemptAt: source?.twoFactorFirstFailedAttemptAt ?? null,
	};
}

/** Diz se a janela da contagem atual ja expirou. */
function windowExpired(state: TwoFactorAttemptState, now: Date): boolean {
	if (!state.firstFailedAttemptAt) {
		return true;
	}

	return (
		now.getTime() - state.firstFailedAttemptAt.getTime() >=
		TWO_FACTOR_ATTEMPT_WINDOW_MS
	);
}

/**
 * Diz se novas tentativas devem ser recusadas sem sequer conferir o codigo.
 *
 * Conferir antes de bloquear seria dar ao atacante exatamente a informacao que
 * o bloqueio existe para negar.
 */
export function isTwoFactorBlocked(
	state: TwoFactorAttemptState,
	now: Date
): boolean {
	if (windowExpired(state, now)) {
		return false;
	}

	return state.failedAttempts >= MAX_TWO_FACTOR_ATTEMPTS;
}

/**
 * Proximo estado depois de um codigo errado. Fora da janela, a contagem
 * recomeca em 1 com um novo carimbo; dentro dela, apenas incrementa e
 * preserva o carimbo original (a janela e do primeiro erro, nao do ultimo —
 * caso contrario cada tentativa empurraria o fim da janela para frente e o
 * limite nunca fecharia).
 */
export function registerFailedAttempt(
	state: TwoFactorAttemptState,
	now: Date
): TwoFactorAttemptState {
	if (windowExpired(state, now)) {
		return { failedAttempts: 1, firstFailedAttemptAt: now };
	}

	return {
		failedAttempts: state.failedAttempts + 1,
		firstFailedAttemptAt: state.firstFailedAttemptAt,
	};
}

/** Diz se este estado ja atingiu o limite (usado apos registrar o erro). */
export function hasReachedLimit(state: TwoFactorAttemptState): boolean {
	return state.failedAttempts >= MAX_TWO_FACTOR_ATTEMPTS;
}
