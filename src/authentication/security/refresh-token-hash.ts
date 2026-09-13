import * as crypto from 'crypto';

/**
 * Hashing do refresh token (TRA-143).
 *
 * O refresh token não é um segredo escolhido por humano: é um JWT assinado
 * por `jwtService.sign`, e sua entropia vem da assinatura HMAC. Além disso,
 * `refreshAccessToken` já roda `jwtService.verify` ANTES de comparar hashes,
 * ou seja, a autenticidade criptográfica do token já foi provada quando esta
 * comparação acontece.
 *
 * O hash armazenado existe, portanto, para *revogação e binding* — provar que
 * este é o token efetivamente emitido e permitir que `signoutAll` o invalide —
 * e não para proteger um segredo passível de ataque de dicionário offline.
 *
 * Argon2 é um KDF de SENHA: deliberadamente lento e caro em memória para
 * resistir a força bruta sobre entrada humana de baixa entropia. Aplicado a uma
 * assinatura HMAC de 256 bits ele não compra nada e custa 64 MiB por login,
 * limitando o processo a ~2 logins concorrentes com UV_THREADPOOL_SIZE=4.
 *
 * Senhas continuam em Argon2id. Isto vale exclusivamente para refresh tokens.
 */

/** Comprimento de um digest SHA-256 em hexadecimal. */
const SHA256_HEX_LENGTH = 64;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Digest SHA-256 (hex) do refresh token, no formato gravado em
 * `user.refreshToken`.
 */
export function hashRefreshToken(refreshToken: string): string {
	return crypto.createHash('sha256').update(refreshToken, 'utf8').digest('hex');
}

/**
 * Diz se o valor armazenado está no formato novo (SHA-256 hex).
 *
 * Qualquer outra coisa — hash Argon2 (`$argon2...`), bcrypt, ou lixo — é
 * tratada como formato legado e delegada ao verificador antigo. Só o próprio
 * backend escreve neste campo, então este teste de formato não é influenciável
 * por entrada de usuário.
 */
export function isRefreshTokenDigest(storedValue: string): boolean {
	return (
		typeof storedValue === 'string' &&
		storedValue.length === SHA256_HEX_LENGTH &&
		SHA256_HEX_PATTERN.test(storedValue)
	);
}

/**
 * Compara o refresh token recebido com o digest armazenado em tempo constante.
 *
 * `crypto.timingSafeEqual` lança se os buffers tiverem tamanhos diferentes, por
 * isso o comprimento é conferido antes — nunca com `===` sobre os digests.
 */
export function matchesRefreshTokenDigest(
	refreshToken: string,
	storedValue: string
): boolean {
	if (!isRefreshTokenDigest(storedValue)) {
		return false;
	}

	const computed = Buffer.from(hashRefreshToken(refreshToken), 'hex');
	const stored = Buffer.from(storedValue, 'hex');

	if (computed.length !== stored.length) {
		return false;
	}

	return crypto.timingSafeEqual(computed, stored);
}
