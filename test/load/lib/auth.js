import http from 'k6/http';
import { check } from 'k6';
import { jsonHeaders } from './config.js';

/**
 * Login contra `POST /auth/signin` (AuthenticationController).
 *
 * O corpo segue o `AuthenticateDto`: `keepConnected` e obrigatorio e o
 * ValidationPipe global roda com `forbidNonWhitelisted: true` — campo extra
 * no corpo vira 400, nao um campo ignorado. Por isso nada alem do que o DTO
 * declara e enviado.
 *
 * A resposta e a `AuthenticationEntity`: { accessToken, refreshToken,
 * expiresIn, user }. Conta com 2FA responde { requiresTwoFactor, tempToken }
 * — usuario de carga nunca tem 2FA, mas o helper trata o caso para que a
 * falha apareca como check quebrado e nao como TypeError no meio do run.
 */
export function signin(base, user, vuId, tags) {
	const res = http.post(
		`${base}/auth/signin`,
		JSON.stringify({
			email: user.email,
			password: user.password,
			keepConnected: false,
		}),
		{ headers: jsonHeaders(vuId), tags: tags || { endpoint: 'auth_signin' } }
	);

	return res;
}

export function tokenFrom(res) {
	if (res.status !== 200) return null;
	let body;
	try {
		body = res.json();
	} catch (err) {
		return null;
	}
	if (!body || body.requiresTwoFactor) return null;
	return body.accessToken || null;
}

/**
 * Login usado em `setup()` dos cenarios de leitura.
 *
 * Roda UMA vez, fora da medicao, de proposito: o argon2id (64 MiB, t=3)
 * custa dezenas de milissegundos de CPU por verificacao. Deixar o login
 * dentro do loop de leitura misturaria o custo do hash com o custo das
 * consultas, e o cenario 2 existe justamente para medir as consultas.
 */
export function loginPool(base, pool) {
	const tokens = [];
	for (let i = 0; i < pool.length; i += 1) {
		const res = signin(base, pool[i], i, { endpoint: 'auth_signin_setup' });
		const token = tokenFrom(res);
		check(res, {
			'setup: login 200': (r) => r.status === 200,
		});
		if (token) tokens.push(token);
	}

	if (tokens.length === 0) {
		throw new Error(
			'\n\n  SETUP FALHOU: nenhum login funcionou.\n\n' +
				'  Causas provaveis:\n' +
				'    - o dataset nao foi semeado (test/load/seed/seed-load-users.mjs);\n' +
				'    - LOAD_USER_PASSWORD nao bate com a senha semeada;\n' +
				'    - a API nao esta no ar em LOAD_BASE_URL;\n' +
				'    - rate limit de 12/min em POST /auth/signin com LOAD_UA_MODE=fixed.\n'
		);
	}

	return tokens;
}
