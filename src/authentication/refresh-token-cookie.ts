import type { Response } from 'express';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_COOKIE_PATH = '/auth';

/**
 * Cookie httpOnly do refresh token (TRA-217). `secure` fica ligado também em
 * dev: localhost é tratado como contexto seguro pelos navegadores atuais, e
 * desligar aqui só pra isso criaria um caminho sem `Secure` em produção por
 * engano. `sameSite: strict` funciona porque web/admin/api são todos
 * `*.trackerr.com.br` — mesmo site, portas diferentes em dev também contam
 * como mesmo site.
 */
export function setRefreshTokenCookie(
	res: Response,
	refreshToken: string,
	expiresAtMs: number
): void {
	res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		path: REFRESH_TOKEN_COOKIE_PATH,
		expires: new Date(expiresAtMs),
	});
}

export function clearRefreshTokenCookie(res: Response): void {
	res.clearCookie(REFRESH_TOKEN_COOKIE, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		path: REFRESH_TOKEN_COOKIE_PATH,
	});
}
