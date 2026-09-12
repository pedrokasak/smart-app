import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
	authHeaders,
	baseUrl,
	banner,
	isLocalTarget,
	jsonHeaders,
	targetVus,
} from '../lib/config.js';
import { pickUser, users } from '../lib/users.js';
import { loginPool, signin, tokenFrom } from '../lib/auth.js';

/**
 * CENARIO 4 — RAMPA DE ESTRESSE (achar o ponto de ruptura, de proposito).
 *
 * Os cenarios 1-3 perguntam "aguenta o regime esperado?". Este pergunta
 * outra coisa: "onde quebra, e como quebra?". Sao perguntas diferentes e
 * exigem scripts diferentes — um teste de regime estavel que sobe ate
 * quebrar nao produz nem um numero de regime nem um numero de ruptura.
 *
 * A rampa NAO tem plateau: sobe em degraus continuos ate LOAD_MAX_VUS. Os
 * thresholds tem `abortOnFail: true`, entao o run PARA no degrau em que a
 * qualidade de servico se rompe. O resultado que importa nao e "passou" —
 * e o numero de VUs impresso no momento do aborto. Anote-o; e o teto atual
 * da instancia.
 *
 * `delayAbortEval: '30s'` existe para nao abortar no aquecimento: pool de
 * conexao do Mongo frio e JIT do Node ainda nao aquecido produzem uma cauda
 * inicial que nao representa nada.
 *
 * Mistura de trafego: 1 login para cada ~9 leituras. E deliberadamente
 * pessimista em relacao ao uso real (o login acontece uma vez por sessao,
 * nao a cada dez telas), porque o argon2 e o recurso escasso e a pergunta
 * deste cenario e onde ele satura.
 *
 * NAO RODE ISTO CONTRA PRODUCAO sem ler a secao "Riscos" do README. Contra
 * um host remoto o script exige confirmacao extra alem de LOAD_ALLOW_REMOTE.
 */

const BASE = baseUrl();
const MAX_VUS = targetVus(Number(__ENV.LOAD_MAX_VUS || 400));
const STEP = __ENV.LOAD_STEP_DURATION || '1m';
const POOL = Math.min(Number(__ENV.LOAD_TOKEN_POOL || 20), users.length);

if (!isLocalTarget(BASE) && __ENV.LOAD_STRESS_REMOTE_ACK !== 'yes') {
	throw new Error(
		`\n\n  RAMPA DE ESTRESSE CONTRA HOST REMOTO BLOQUEADA: ${BASE}\n\n` +
			`  Este cenario sobe ate ${MAX_VUS} VUs e para so quando a qualidade\n` +
			`  de servico se rompe. Contra producao isso esgota o pool de conexoes\n` +
			`  do Mongo e derruba usuario real.\n\n` +
			`  Se e mesmo o que voce quer, adicione:  -e LOAD_STRESS_REMOTE_ACK=yes\n`
	);
}

const breakingPoint = new Counter('stress_errors_total');
const loginDuration = new Trend('stress_login_duration', true);

function steps() {
	// Cinco degraus ate o teto. Degraus largos o bastante para o sistema
	// estabilizar em cada nivel antes do proximo — subida continua mediria
	// o transiente, nao o regime de cada patamar.
	const out = [];
	for (let i = 1; i <= 5; i += 1) {
		out.push({ duration: STEP, target: Math.ceil((MAX_VUS * i) / 5) });
	}
	out.push({ duration: '30s', target: 0 });
	return out;
}

export const options = {
	scenarios: {
		stress: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: steps(),
			gracefulRampDown: '10s',
		},
	},
	thresholds: {
		/**
		 * Ruptura de latencia. 2000 ms no p95 do conjunto e o ponto em que o
		 * produto deixou de responder em tempo util — o navegador ainda nao
		 * desistiu, mas o usuario ja. Abortar aqui, em vez de deixar a rampa
		 * seguir ate o timeout, preserva o numero: o run para NO degrau da
		 * ruptura, e o degrau e a resposta.
		 */
		http_req_duration: [
			{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' },
		],

		/**
		 * 5% de erro. Mais frouxo que os 0,5%-1% dos cenarios de regime, de
		 * proposito: aqui o objetivo e chegar perto da borda antes de parar.
		 * Abaixo de 5% o sistema ainda esta degradando; acima, ja quebrou.
		 */
		http_req_failed: [
			{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' },
		],
	},
};

export function setup() {
	console.log(banner('04-stress-ramp', BASE, MAX_VUS));
	console.log(
		`  rampa: 5 degraus de ${STEP} ate ${MAX_VUS} VUs, com aborto na ruptura.\n` +
			`  O RESULTADO E O NUMERO DE VUs NO MOMENTO DO ABORTO — anote-o.\n`
	);
	const tokens = loginPool(BASE, users.slice(0, POOL));
	return { base: BASE, tokens };
}

export default function (data) {
	// 1 em cada 10 iteracoes faz login de verdade (caminho caro).
	if (__ITER % 10 === 0) {
		const user = pickUser(__VU, __ITER);
		const res = signin(data.base, user, __VU, { endpoint: 'stress_signin' });
		loginDuration.add(res.timings.duration);
		const ok = check(res, {
			'stress: login -> 200': (r) => r.status === 200 && tokenFrom(r) !== null,
		});
		if (!ok) breakingPoint.add(1);
		return;
	}

	const token = data.tokens[__VU % data.tokens.length];
	const res = http.get(`${data.base}/portfolio`, {
		headers: authHeaders(token, __VU),
		tags: { endpoint: 'stress_read' },
	});
	const ok = check(res, { 'stress: leitura -> 200': (r) => r.status === 200 });
	if (!ok) breakingPoint.add(1);

	// Probe sem estado: separa "banco lento" de "processo morto".
	const health = http.get(`${data.base}/health`, {
		headers: jsonHeaders(__VU),
		tags: { endpoint: 'stress_health' },
	});
	check(health, { 'stress: health -> 200': (r) => r.status === 200 });
}

export function teardown() {
	console.log(
		'\n  Leia o resumo acima: o ultimo degrau alcancado antes do aborto e o\n' +
			'  teto desta instancia. Compare com `docker stats` no mesmo periodo\n' +
			'  para saber SE o teto e CPU, RAM ou conexao de banco.\n'
	);
}
