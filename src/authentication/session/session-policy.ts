import type { JwtSignOptions } from '@nestjs/jwt';
import { sessionTtlDefault, sessionTtlKeepConnected } from 'src/env';

type JwtExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

/**
 * Política de sessão (TRA-245).
 *
 * O prazo da sessão é o prazo do refresh token e é absoluto: conta do login e
 * não se renova com o uso. "Manter conectado" só escolhe qual prazo vale.
 * Antes, a opção chegava ao servidor e era ignorada — todo login ganhava o
 * mesmo refresh token de 7 dias, renovado em silêncio pelo access token.
 */
export function sessionTtl(keepConnected: boolean): JwtExpiresIn {
	return (
		keepConnected ? sessionTtlKeepConnected : sessionTtlDefault
	) as JwtExpiresIn;
}

/**
 * Ao girar o refresh token, o novo herda o fim da sessão do anterior: girar
 * não pode esticar a sessão. Devolve os segundos que faltam para `exp`.
 */
export function remainingSessionSeconds(
	exp: number,
	nowMs = Date.now()
): number {
	return Math.max(1, exp - Math.floor(nowMs / 1000));
}

/**
 * Janela em que o refresh token anterior ainda é aceito logo depois de uma
 * rotação. Cobre abas e requisições concorrentes que saíram com o token velho
 * antes de a resposta da rotação chegar. Fora dela, token velho é reuso.
 */
export const REFRESH_ROTATION_GRACE_MS = 60 * 1000;

/**
 * Teto de sessões simultâneas por usuário. Sessão do web não tem identificador
 * de aparelho, então cada login abre uma nova; sem o teto, automação de login
 * cresceria a coleção até o token expirar.
 */
export const MAX_SESSIONS_PER_USER = 10;

/**
 * Até quando, depois de uma rotação, o token anterior ainda recupera a sessão
 * se o sucessor nunca foi usado (resposta da rotação perdida). Limita o tempo
 * em que um token antigo roubado consegue renovar sem ser detectado. Quem
 * voltar depois disto faz login de novo.
 */
export const REFRESH_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinRotationGrace(
	rotatedAt: Date | null | undefined,
	nowMs = Date.now()
): boolean {
	if (!rotatedAt) return false;
	return nowMs - new Date(rotatedAt).getTime() <= REFRESH_ROTATION_GRACE_MS;
}
