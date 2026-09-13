import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
	baseUrl,
	banner,
	jsonHeaders,
	plateau,
	rampProfile,
	targetVus,
} from '../lib/config.js';
import { pickUser, users } from '../lib/users.js';
import { signin, tokenFrom } from '../lib/auth.js';

/**
 * CENARIO 1 — AUTENTICACAO (a porta de entrada, e o primeiro gargalo).
 *
 * Por que este cenario vem antes de todos: `PasswordSecurityService` usa
 * argon2id com memoryCost 64 MiB, timeCost 3, parallelism 1. Isso e caro DE
 * PROPOSITO — e a defesa contra quebra de senha por GPU. A consequencia no
 * dimensionamento e direta e nao esta medida em lugar nenhum:
 *
 *   - cada operacao aloca 64 MiB e ocupa uma thread do pool do libuv
 *     (default UV_THREADPOOL_SIZE=4);
 *   - e um login BEM-SUCEDIDO faz DUAS operacoes, nao uma: `verifyPassword`
 *     na senha e, em `issueSessionTokens`, `hashPassword` no refresh token
 *     antes de grava-lo no doc do usuario;
 *   - logo o teto de logins simultaneos de um processo Node e ~2, e o pico
 *     de RAM so de hashing e ~4 x 64 MiB = 256 MiB;
 *   - num VPS de 4 GB isso e o suficiente para competir com o Mongo pelo
 *     que sobrar de memoria.
 *
 * `signin` executa o argon2 mesmo quando o e-mail NAO existe (verificacao
 * contra um hash descartavel, para nao vazar existencia por tempo —
 * TRA-89). Ou seja, credencial invalida NAO e um caminho barato: custa uma
 * verificacao inteira. Custa menos que um login valido (que faz duas
 * operacoes) mas nao custa quase nada, e e por isso que
 * `LOAD_AUTH_INVALID_PCT` existe — uma enxurrada de tentativas invalidas e
 * carga de CPU real, nao ruido.
 *
 * O probe em `GET /health` roda no mesmo run e e a leitura mais util do
 * cenario: `/health` nao toca banco nem CPU. Se a latencia DELE subir junto
 * com a do login, o event loop esta faminto — a degradacao nao esta no
 * hashing isolado, esta no processo inteiro.
 */

const VUS = targetVus(30);
const BASE = baseUrl();
const PLATEAU = plateau('3m');

/** Percentual de tentativas com senha errada. Default 10%. */
const INVALID_PCT = Number(__ENV.LOAD_AUTH_INVALID_PCT || 10);

const loginSuccess = new Rate('auth_login_success');
const loginDuration = new Trend('auth_login_duration', true);
const healthDuration = new Trend('auth_health_probe_duration', true);
const rateLimited = new Rate('auth_rate_limited');

export const options = {
	scenarios: {
		auth: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: rampProfile(VUS, PLATEAU),
			gracefulRampDown: '20s',
		},
	},
	thresholds: {
		/**
		 * p95 de 1500 ms para o login.
		 *
		 * Justificativa: uma verificacao argon2id nesta calibragem custa
		 * ~60-120 ms de CPU num vCPU de VPS. 1500 ms no p95 e ~15x o custo
		 * isolado — folga deliberada para fila no threadpool sob carga. Acima
		 * disso o usuario percebe o login como travado, e o valor deixa de ser
		 * "tem fila" e passa a ser "nao aguenta". p99 em 3000 ms marca o ponto
		 * em que a cauda comeca a virar timeout de cliente.
		 */
		'http_req_duration{endpoint:auth_signin}': ['p(95)<1500', 'p(99)<3000'],

		/**
		 * 1% de erro. Nao e tolerancia a bug: e margem para reset de conexao e
		 * ruido de rede da propria maquina de carga. Login que falha e usuario
		 * que nao entra no produto — nao ha degradacao graciosa possivel aqui.
		 */
		'http_req_failed{endpoint:auth_signin}': ['rate<0.01'],
		auth_login_success: ['rate>0.99'],

		/**
		 * O probe de saude e o detector de fome de event loop. `GET /health`
		 * devolve uma string constante: 250 ms no p95 ja significa que a fila
		 * do event loop tem centenas de milissegundos de trabalho a frente.
		 */
		'http_req_duration{endpoint:health}': ['p(95)<250'],

		/**
		 * 429 aqui invalida o run: significa que o fingerprint do rate limiter
		 * colapsou e o teste esta medindo o limitador, nao a aplicacao.
		 */
		auth_rate_limited: ['rate<0.01'],
	},
};

export function setup() {
	console.log(banner('01-auth', BASE, VUS));
	console.log(
		`  usuarios no pool: ${users.length} | senha errada: ${INVALID_PCT}%`
	);
	return { base: BASE };
}

export default function (data) {
	const user = pickUser(__VU, __ITER);
	const invalid = __ITER % 100 < INVALID_PCT;

	const res = signin(
		data.base,
		invalid ? { email: user.email, password: `${user.password}-errada` } : user,
		__VU,
		{ endpoint: 'auth_signin', valid: invalid ? 'no' : 'yes' }
	);

	loginDuration.add(res.timings.duration);
	rateLimited.add(res.status === 429);

	if (invalid) {
		// Credencial invalida DEVE custar o mesmo e responder 401 — nunca 404.
		// Se isto quebrar, a protecao de enumeracao da TRA-89 regrediu.
		check(res, {
			'senha errada -> 401': (r) => r.status === 401,
		});
		loginSuccess.add(true);
	} else {
		const ok = check(res, {
			'login -> 200': (r) => r.status === 200,
			'login devolve accessToken': (r) => tokenFrom(r) !== null,
		});
		loginSuccess.add(ok);
	}

	const health = http.get(`${data.base}/health`, {
		headers: jsonHeaders(__VU),
		tags: { endpoint: 'health' },
	});
	healthDuration.add(health.timings.duration);
	check(health, { 'health -> 200': (r) => r.status === 200 });

	// Pausa de usuario real: ninguem faz login em loop apertado.
	sleep(Math.random() * 2 + 1);
}
