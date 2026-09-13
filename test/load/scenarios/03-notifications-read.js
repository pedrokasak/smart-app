import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
	authHeaders,
	baseUrl,
	banner,
	plateau,
	targetVus,
} from '../lib/config.js';
import { users } from '../lib/users.js';
import { loginPool } from '../lib/auth.js';

/**
 * CENARIO 3a — LADO HTTP DO CAMINHO DE NOTIFICACAO (TRA-136).
 *
 * O cenario 3 tem duas metades, porque o caminho tem duas metades:
 *
 *   3a (este arquivo)              o que o USUARIO faz depois que o resumo
 *                                  chega: abre o centro in-app e pagina.
 *   3b (test/load/queue/burst.mjs) o que o CRON faz: publica ~5 mil eventos
 *                                  de uma vez e a fila precisa drenar.
 *
 * As duas nao podem virar um script so: 3b nao passa por HTTP nenhum — o
 * cron dispara dentro do processo e o trabalho sai pela fila. k6 nao fala
 * Redis sem extensao compilada; por isso 3b e um script Node que usa o
 * `bullmq` que ja e dependencia do servidor.
 *
 * Rotas reais, do `InAppNotificationsController` (@Controller('notifications'),
 * JwtAuthGuard):
 *
 *   GET /notifications?limit=20    listagem paginada por cursor
 *   GET /notifications/unread-count
 *
 * O pico real deste caminho e por natureza sincronizado: o push diario sai
 * as 09:00 (`DailyPushDigestScheduler`, cron '0 9 * * *'). Todo mundo que
 * recebeu o push abre o app na mesma janela de minutos. Por isso a rampa
 * aqui e mais agressiva que a do cenario 2 — 15s de subida, nao 60s.
 *
 * SOMENTE LEITURA por default. `PATCH /notifications/read-all` grava e fica
 * atras de LOAD_NOTIFICATIONS_WRITE=true, para que rodar este cenario contra
 * um ambiente compartilhado nao marque como lidas notificacoes de ninguem.
 */

const VUS = targetVus(60);
const BASE = baseUrl();
const PLATEAU = plateau('3m');
const POOL = Math.min(Number(__ENV.LOAD_TOKEN_POOL || 20), users.length);
const WRITE = __ENV.LOAD_NOTIFICATIONS_WRITE === 'true';

const listDuration = new Trend('notifications_list', true);

export const options = {
	scenarios: {
		notifications: {
			executor: 'ramping-vus',
			startVUs: 0,
			// Perfil de "todo mundo abriu o push ao mesmo tempo": subida curta,
			// plateau, descida lenta (as pessoas nao fecham o app juntas).
			stages: [
				{ duration: '15s', target: VUS },
				{ duration: PLATEAU, target: VUS },
				{ duration: '1m', target: 0 },
			],
			gracefulRampDown: '20s',
		},
	},
	thresholds: {
		/**
		 * 600 ms no p95 para a listagem.
		 *
		 * A paginacao e por cursor (`notification-cursor.ts`), nao por skip —
		 * ou seja, o custo nao cresce com a profundidade da pagina. 600 ms
		 * admite a leitura indexada mais a serializacao do payload de ate 20
		 * documentos com folga; acima disso o gargalo e o Mongo sob a carga
		 * simultanea, nao a consulta em si.
		 */
		'http_req_duration{endpoint:notifications_list}': ['p(95)<600'],

		/**
		 * 300 ms para a contagem: e um count indexado, e o badge do sino e
		 * pedido em toda navegacao. Se ele passa disso, o app inteiro arrasta.
		 */
		'http_req_duration{endpoint:notifications_unread}': ['p(95)<300'],

		http_req_failed: ['rate<0.005'],
		checks: ['rate>0.99'],
	},
};

export function setup() {
	console.log(banner('03-notifications-read', BASE, VUS));
	console.log(`  escrita (read-all): ${WRITE ? 'LIGADA' : 'desligada'}`);
	const tokens = loginPool(BASE, users.slice(0, POOL));
	return { base: BASE, tokens };
}

export default function (data) {
	const token = data.tokens[__VU % data.tokens.length];
	const headers = authHeaders(token, __VU);

	const unread = http.get(`${data.base}/notifications/unread-count`, {
		headers,
		tags: { endpoint: 'notifications_unread' },
	});
	check(unread, {
		'unread-count -> 200': (r) => r.status === 200,
		'unread-count tem o campo': (r) =>
			r.status === 200 && r.json('unreadCount') !== undefined,
	});

	const list = http.get(`${data.base}/notifications?limit=20`, {
		headers,
		tags: { endpoint: 'notifications_list' },
	});
	listDuration.add(list.timings.duration);
	const listOk = check(list, {
		'GET /notifications -> 200': (r) => r.status === 200,
	});

	// Segunda pagina quando existe cursor: e o caminho que a rolagem do
	// centro in-app percorre, e o que provaria uma paginacao degradante.
	if (listOk) {
		const cursor = list.json('nextCursor');
		if (cursor) {
			const page2 = http.get(
				`${data.base}/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`,
				{ headers, tags: { endpoint: 'notifications_list' } }
			);
			listDuration.add(page2.timings.duration);
			check(page2, { 'pagina 2 -> 200': (r) => r.status === 200 });
		}
	}

	if (WRITE) {
		const readAll = http.patch(`${data.base}/notifications/read-all`, null, {
			headers,
			tags: { endpoint: 'notifications_read_all' },
		});
		check(readAll, { 'read-all -> 200': (r) => r.status === 200 });
	}

	sleep(Math.random() * 3 + 1);
}
