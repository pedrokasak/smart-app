import http from 'k6/http';
import { check, group, sleep } from 'k6';
import {
	authHeaders,
	baseUrl,
	banner,
	plateau,
	rampProfile,
	targetVus,
} from '../lib/config.js';
import { users } from '../lib/users.js';
import { loginPool } from '../lib/auth.js';

/**
 * CENARIO 5 — DASHBOARD, PROVENTOS E INSIGHTS (TRA-183).
 *
 * As telas mais pesadas depois da entrada, todas só leitura:
 *
 *   GET /portfolio/composition               alocação, yield, desvio da meta
 *   GET /portfolio/returns                   TWR com séries diárias (CDI/IBOV)
 *   GET /portfolio/dividend-income/insight   renda de proventos explicada
 *   GET /portfolio/upcoming-dividends        agenda de proventos a receber
 *   GET /ai/error-radar                      radar anti-erro (+ correlação)
 *
 * `returns` e `error-radar` leem séries históricas por ativo (COTAHIST
 * guardado; Yahoo só quando a série não cobre o período). São as candidatas
 * a cauda longa: o threshold delas é mais frouxo, e a diferença para as
 * outras é o dado que interessa. Nenhuma rota aqui escreve nem chama LLM.
 *
 * Como os outros cenários, aponta para localhost por padrão; outro host
 * exige `LOAD_ALLOW_REMOTE=i-understand-the-risk` (ver lib/config.js).
 */

const VUS = targetVus(30);
const BASE = baseUrl();
const PLATEAU = plateau('5m');
const POOL = Math.min(Number(__ENV.LOAD_TOKEN_POOL || 20), users.length);

export const options = {
	scenarios: {
		dashboard: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: rampProfile(VUS, PLATEAU),
			gracefulRampDown: '20s',
		},
	},
	thresholds: {
		'http_req_duration{endpoint:composition}': ['p(95)<800'],
		'http_req_duration{endpoint:dividend_insight}': ['p(95)<800'],
		'http_req_duration{endpoint:upcoming_dividends}': ['p(95)<500'],
		// Séries históricas por ativo: mais folga, e é aqui que o gargalo aparece.
		'http_req_duration{endpoint:returns}': ['p(95)<2500'],
		'http_req_duration{endpoint:error_radar}': ['p(95)<2500'],
		http_req_failed: ['rate<0.01'],
		checks: ['rate>0.98'],
	},
};

export function setup() {
	console.log(banner('05-read-dashboard', BASE, VUS));
	console.log(`  autenticando ${POOL} usuario(s) fora da medicao...`);
	const tokens = loginPool(BASE, users.slice(0, POOL));
	console.log(`  ${tokens.length} token(s) obtido(s)`);
	return { base: BASE, tokens };
}

const ROUTES = [
	['composition', '/portfolio/composition'],
	['returns', '/portfolio/returns'],
	['dividend_insight', '/portfolio/dividend-income/insight'],
	['upcoming_dividends', '/portfolio/upcoming-dividends'],
	['error_radar', '/ai/error-radar'],
];

export default function (data) {
	const token = data.tokens[__VU % data.tokens.length];
	const headers = authHeaders(token, __VU);

	group('dashboard', () => {
		for (const [endpoint, path] of ROUTES) {
			const response = http.get(`${data.base}${path}`, {
				headers,
				tags: { endpoint },
			});
			check(response, {
				[`GET ${path} -> 200`]: (r) => r.status === 200,
			});
		}
	});

	sleep(Math.random() * 5 + 3);
}
