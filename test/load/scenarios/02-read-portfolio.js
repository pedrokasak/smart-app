import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
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
 * CENARIO 2 — CAMINHO DE LEITURA (o que o usuario logado dispara ao chegar).
 *
 * Rotas reais lidas do `PortfolioController` (@Controller('portfolio'),
 * protegido por JwtAuthGuard) e do `InAppNotificationsController`
 * (@Controller('notifications')):
 *
 *   GET /portfolio                 findAll        — lista as carteiras
 *   GET /portfolio/summary         getSummary     — total agregado do topo
 *   GET /portfolio/assets          findAllAssets  — a rota CARA (ver abaixo)
 *   GET /notifications/unread-count               — badge do sino
 *
 * `GET /portfolio/assets` merece atencao especial no resultado: alem de
 * carregar as carteiras com os ativos, ela faz um `TradeModel.find({ userId })`
 * SEM limite e deriva o preco medio em memoria a cada requisicao. Para um
 * usuario com anos de negociacoes importadas da B3 isso cresce sem teto —
 * e o candidato numero um a explicar uma cauda longa aqui. O threshold dela
 * e propositalmente mais frouxo que o das outras, e a diferenca entre os
 * dois numeros e o dado que interessa.
 *
 * O login acontece no `setup()`, uma vez, fora da medicao: este cenario mede
 * consulta, nao argon2 (isso e o cenario 1).
 */

const VUS = targetVus(50);
const BASE = baseUrl();
const PLATEAU = plateau('5m');

/** Quantos usuarios do pool serao autenticados no setup. */
const POOL = Math.min(
	Number(__ENV.LOAD_TOKEN_POOL || 20),
	users.length
);

const listDuration = new Trend('read_portfolio_list', true);
const summaryDuration = new Trend('read_portfolio_summary', true);
const assetsDuration = new Trend('read_portfolio_assets', true);

export const options = {
	scenarios: {
		read: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: rampProfile(VUS, PLATEAU),
			gracefulRampDown: '20s',
		},
	},
	thresholds: {
		/**
		 * 500 ms no p95 para as duas rotas indexadas.
		 *
		 * `getUserPortfolios` filtra por `userId`, que tem indice dedicado no
		 * `portfolioSchema` — a consulta e uma leitura indexada, nao um scan.
		 * Num Mongo sidecar, no mesmo host, sem latencia de rede, isso deveria
		 * ficar em dezenas de milissegundos. 500 ms admite uma ordem de
		 * grandeza de fila e ainda mantem a tela de entrada abaixo do limiar
		 * em que o usuario percebe espera. Ultrapassar significa contencao
		 * (pool de conexao, IO do disco do VPS), nao consulta lenta.
		 */
		'http_req_duration{endpoint:portfolio_list}': ['p(95)<500'],
		'http_req_duration{endpoint:portfolio_summary}': ['p(95)<500'],

		/**
		 * 1200 ms para /portfolio/assets: tres vezes o das outras, porque a
		 * rota faz uma consulta a mais (todas as trades do usuario) e trabalho
		 * de CPU por requisicao. O threshold e frouxo de proposito — o que se
		 * quer detectar aqui e crescimento com o volume de trades, e para isso
		 * o valor precisa ser alcancavel com dataset pequeno e estourar com
		 * dataset realista.
		 */
		'http_req_duration{endpoint:portfolio_assets}': ['p(95)<1200'],

		'http_req_duration{endpoint:notifications_unread}': ['p(95)<400'],

		/** Leitura autenticada nao tem por que falhar. 0,5% e ruido de rede. */
		http_req_failed: ['rate<0.005'],
		checks: ['rate>0.99'],
	},
};

export function setup() {
	console.log(banner('02-read-portfolio', BASE, VUS));
	console.log(`  autenticando ${POOL} usuario(s) fora da medicao...`);
	const tokens = loginPool(BASE, users.slice(0, POOL));
	console.log(`  ${tokens.length} token(s) obtido(s)`);
	return { base: BASE, tokens };
}

export default function (data) {
	const token = data.tokens[__VU % data.tokens.length];
	const headers = authHeaders(token, __VU);

	group('landing', () => {
		const list = http.get(`${data.base}/portfolio`, {
			headers,
			tags: { endpoint: 'portfolio_list' },
		});
		listDuration.add(list.timings.duration);
		check(list, {
			'GET /portfolio -> 200': (r) => r.status === 200,
			'GET /portfolio devolve array': (r) => Array.isArray(r.json()),
		});

		const summary = http.get(`${data.base}/portfolio/summary`, {
			headers,
			tags: { endpoint: 'portfolio_summary' },
		});
		summaryDuration.add(summary.timings.duration);
		check(summary, {
			'GET /portfolio/summary -> 200': (r) => r.status === 200,
			'summary tem totalValue': (r) =>
				r.status === 200 && r.json('totalValue') !== undefined,
		});

		const assets = http.get(`${data.base}/portfolio/assets`, {
			headers,
			tags: { endpoint: 'portfolio_assets' },
		});
		assetsDuration.add(assets.timings.duration);
		check(assets, {
			'GET /portfolio/assets -> 200': (r) => r.status === 200,
		});

		const unread = http.get(`${data.base}/notifications/unread-count`, {
			headers,
			tags: { endpoint: 'notifications_unread' },
		});
		check(unread, {
			'GET /notifications/unread-count -> 200': (r) => r.status === 200,
		});
	});

	// Tempo de leitura da tela antes do proximo ciclo.
	sleep(Math.random() * 4 + 2);
}
