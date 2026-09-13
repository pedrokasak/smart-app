#!/usr/bin/env node
/**
 * CENARIO 3b — O BURST DO CRON NA FILA DURAVEL (TRA-136).
 *
 * Este e o unico numero da TRA-136 que nunca foi medido. O
 * `queue.config.ts` documenta a conta:
 *
 *     concorrencia 20  ->  20 / 0,2s  =  ~100 jobs/s por instancia
 *     5.000 jobs / 100 =  ~50s para drenar o burst inteiro
 *
 * Os ~200 ms por job sao uma ESTIMATIVA de "IO-bound: Mongo + Resend/FCM +
 * eventualmente trackerr-ia". Este script substitui a estimativa por
 * medicao. Ele nao passa por HTTP porque o caminho real tambem nao passa: o
 * `@Cron` dispara dentro do processo, o produtor publica no barramento e o
 * `EventQueueDispatcher` enfileira. O que se pode reproduzir de fora e a
 * outra ponta da mesma fila.
 *
 * NAO E UM SCRIPT k6. k6 nao fala Redis sem extensao compilada (xk6-redis).
 * Este script usa `bullmq` e `ioredis`, que ja sao dependencias do servidor
 * — nenhuma dependencia nova entra no package.json por causa dele.
 *
 * O QUE ELE MEDE
 *   1. taxa de ENFILEIRAMENTO, reproduzindo o par de comandos que o
 *      `BullmqEventQueueAdapter` executa por evento (getJob + add), para que
 *      o numero seja comparavel ao caminho do produtor;
 *   2. taxa de DRENAGEM: amostra `getJobCounts()` ate a fila voltar ao
 *      estado inicial, e reporta jobs/s reais e latencia por job
 *      (finishedOn - timestamp) em p50/p95.
 *
 * EFEITOS COLATERAIS
 *   Com o tipo default (`loadtest.synthetic.noop`) NENHUM. O envelope e
 *   valido para `assertDomainEvent`, entao o worker o aceita; o
 *   `NotificationEventConsumer` assina '**' e recebe, mas
 *   `ThresholdEngineService.decide` devolve passThrough para tipo fora do
 *   registro e `toNotificationPayload` devolve null — o evento morre ali,
 *   sem escrita no Mongo, sem e-mail e sem push. O que sobra medido e o
 *   teto de transporte: Redis + BullMQ + loop do worker.
 *
 *   Com --event-type apontando para um tipo REAL do registro
 *   (`portfolio.score.evaluated`, etc.) o caminho completo executa: grava
 *   Notification no Mongo, dispara canal de e-mail (Resend) e defere push.
 *   ISSO MANDA E-MAIL DE VERDADE. Por isso exige
 *   LOAD_QUEUE_ALLOW_REAL_EVENTS=i-understand-the-risk e um --subject que
 *   seja o _id de um usuario de carga.
 *
 * PRE-REQUISITOS
 *   - o servidor precisa estar NO AR com EVENTS_QUEUE_WORKER_ENABLED=true,
 *     senao nada dreana e o script so mede enfileiramento;
 *   - o Redis precisa ser alcancavel. No docker-compose ele NAO publica a
 *     porta 6379 de proposito. Para rodar do host, abra um tunel temporario:
 *         docker compose exec -T redis true   # confirma que subiu
 *         docker run --rm --network <rede> -v "$PWD":/app -w /app node:20 \
 *             node test/load/queue/burst.mjs
 *     ou rode o script de dentro da rede do compose.
 *
 * USO
 *   node test/load/queue/burst.mjs [--size 5000] [--event-type <tipo>]
 *                                  [--subject <userId>] [--purge]
 */

import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REAL_EVENT_TYPES = [
	'portfolio.dividend.received',
	'portfolio.allocation.breached',
	'portfolio.score.evaluated',
	'ai.insight.high_priority',
	'market.quote.stale',
	'subscription.expiring',
];

const SYNTHETIC_TYPE = 'loadtest.synthetic.noop';
const REAL_ACK = 'i-understand-the-risk';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return fallback;
}

const flags = {
	size: Number(arg('size', process.env.LOAD_QUEUE_BURST_SIZE || 5000)),
	eventType: arg('event-type', process.env.LOAD_QUEUE_EVENT_TYPE || SYNTHETIC_TYPE),
	subject: arg('subject', process.env.LOAD_QUEUE_SUBJECT || 'loadtest-subject'),
	purge: process.argv.includes('--purge'),
	queueName: process.env.LOAD_QUEUE_NAME || process.env.EVENTS_QUEUE_NAME || 'trackerr.events',
	host: process.env.LOAD_QUEUE_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
	port: Number(process.env.LOAD_QUEUE_REDIS_PORT || process.env.REDIS_PORT || 6379),
	password: process.env.LOAD_QUEUE_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
	db: Number(process.env.LOAD_QUEUE_REDIS_DB || process.env.REDIS_DB || 0),
	timeoutMs: Number(process.env.LOAD_QUEUE_DRAIN_TIMEOUT_MS || 10 * 60_000),
};

if (
	REAL_EVENT_TYPES.includes(flags.eventType) &&
	process.env.LOAD_QUEUE_ALLOW_REAL_EVENTS !== REAL_ACK
) {
	console.error(
		`\n  TIPO DE EVENTO REAL BLOQUEADO: ${flags.eventType}\n\n` +
			`  Este tipo esta no registro de eventos de dominio. Enfileira-lo executa\n` +
			`  o caminho completo: grava Notification no Mongo, dispara e-mail pelo\n` +
			`  Resend e defere push. ISSO MANDA E-MAIL DE VERDADE para o dono do\n` +
			`  --subject informado.\n\n` +
			`  Se e mesmo o que voce quer, e o --subject e um usuario de carga:\n` +
			`      LOAD_QUEUE_ALLOW_REAL_EVENTS=${REAL_ACK}\n\n` +
			`  Para medir so o teto de transporte, sem efeito nenhum, omita\n` +
			`  --event-type (default: ${SYNTHETIC_TYPE}).\n`
	);
	process.exit(1);
}

/** Envelope valido para `validateDomainEvent` (domain-event.contract.ts). */
function envelope(index) {
	return {
		id: randomUUID(),
		type: flags.eventType,
		version: 1,
		occurredAt: new Date().toISOString(),
		producer: 'load-test.queue-burst',
		subject: flags.subject,
		correlationId: `loadtest-burst-${index}`,
		payload: { index, synthetic: flags.eventType === SYNTHETIC_TYPE },
	};
}

function pct(sorted, p) {
	if (sorted.length === 0) return 0;
	const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[i];
}

async function main() {
	const connection = new IORedis({
		host: flags.host,
		port: flags.port,
		password: flags.password,
		db: flags.db,
		maxRetriesPerRequest: null,
	});
	const queue = new Queue(flags.queueName, { connection });

	console.log(
		`\n[03b-queue-burst] fila=${flags.queueName} redis=${flags.host}:${flags.port}/${flags.db}\n` +
			`  eventos=${flags.size} tipo=${flags.eventType}` +
			`${flags.eventType === SYNTHETIC_TYPE ? ' (sem efeito colateral)' : ' (EFEITO REAL)'}\n`
	);

	if (flags.purge) {
		await queue.drain(true);
		await queue.clean(0, 100_000, 'completed');
		await queue.clean(0, 100_000, 'failed');
		console.log('  fila limpa (--purge).\n');
	}

	const baseline = await queue.getJobCounts('waiting', 'active', 'delayed');
	const pendingBaseline =
		baseline.waiting + baseline.active + baseline.delayed;
	console.log(`  estado inicial: ${JSON.stringify(baseline)}`);

	if (pendingBaseline > 0) {
		console.log(
			`  AVISO: ${pendingBaseline} job(s) pendente(s) antes do burst. A\n` +
				`  drenagem medida inclui esse residuo. Use --purge para zerar.\n`
		);
	}

	// --- 1. Enfileiramento -------------------------------------------------
	// Um por vez, com getJob antes do add: e exatamente o par de comandos do
	// BullmqEventQueueAdapter.enqueue. addBulk seria mais rapido e mediria
	// outra coisa — nao o caminho que o produtor real percorre.
	const ids = [];
	const enqueueStart = Date.now();
	for (let i = 0; i < flags.size; i += 1) {
		const event = envelope(i);
		const existing = await queue.getJob(event.id);
		if (existing) continue;
		await queue.add(event.type, event, {
			jobId: event.id,
			attempts: Number(process.env.EVENTS_QUEUE_ATTEMPTS || 5),
			backoff: {
				type: 'exponential',
				delay: Number(process.env.EVENTS_QUEUE_BACKOFF_MS || 5000),
			},
			removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
			removeOnFail: { age: 7 * 24 * 60 * 60 },
		});
		ids.push(event.id);
		if ((i + 1) % 500 === 0) {
			process.stdout.write(`  enfileirados ${i + 1}/${flags.size}\r`);
		}
	}
	const enqueueMs = Date.now() - enqueueStart;
	console.log(
		`\n  ENFILEIRAMENTO: ${ids.length} evento(s) em ${(enqueueMs / 1000).toFixed(2)}s ` +
			`= ${(ids.length / (enqueueMs / 1000)).toFixed(1)} eventos/s\n`
	);

	// --- 2. Drenagem -------------------------------------------------------
	console.log('  aguardando o worker drenar (Ctrl+C aborta a MEDICAO, nao a fila)...');
	const drainStart = Date.now();
	let last = -1;
	let pending = Infinity;

	while (Date.now() - drainStart < flags.timeoutMs) {
		const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
		pending = counts.waiting + counts.active + counts.delayed;
		if (pending !== last) {
			const elapsed = (Date.now() - drainStart) / 1000;
			process.stdout.write(
				`  pendentes=${String(pending).padStart(6)} ` +
					`t=${elapsed.toFixed(1)}s        \r`
			);
			last = pending;
		}
		if (pending <= pendingBaseline) break;
		await new Promise((r) => setTimeout(r, 250));
	}

	const drainMs = Date.now() - drainStart;
	const drained = pending <= pendingBaseline;

	console.log('\n');
	if (!drained) {
		console.log(
			`  NAO DRENOU em ${(flags.timeoutMs / 1000).toFixed(0)}s — ainda ${pending} pendente(s).\n` +
				`  Causas provaveis: worker desligado (EVENTS_QUEUE_WORKER_ENABLED=false),\n` +
				`  rate limit da fila (EVENTS_QUEUE_RATE_LIMIT_MAX) ou jobs em retry.\n`
		);
	} else {
		console.log(
			`  DRENAGEM: ${ids.length} job(s) em ${(drainMs / 1000).toFixed(2)}s ` +
				`= ${(ids.length / (drainMs / 1000)).toFixed(1)} jobs/s\n`
		);
		console.log(
			`  Referencia da TRA-136: ~100 jobs/s e ~50s para 5.000. ` +
				`Medido acima.\n`
		);
	}

	// --- 3. Latencia por job ----------------------------------------------
	// Amostra os concluidos e usa os carimbos do proprio BullMQ.
	const sample = await queue.getJobs(['completed'], 0, 999);
	const latencies = sample
		.filter((j) => j && j.finishedOn && j.timestamp)
		.map((j) => j.finishedOn - j.timestamp)
		.sort((a, b) => a - b);

	if (latencies.length > 0) {
		console.log(
			`  LATENCIA POR JOB (amostra de ${latencies.length} concluidos, ms):\n` +
				`    p50=${pct(latencies, 50)}  p95=${pct(latencies, 95)}  ` +
				`p99=${pct(latencies, 99)}  max=${latencies[latencies.length - 1]}\n`
		);
		console.log(
			`  Compare o p50 com os ~200ms estimados no queue.config.ts. Se o\n` +
				`  medido for muito menor, a concorrencia 20 esta sobrando; se for\n` +
				`  maior, o burst de 5 mil nao dreana nos ~50s previstos.\n`
		);
	}

	const failed = await queue.getJobCounts('failed');
	if (failed.failed > 0) {
		console.log(`  ATENCAO: ${failed.failed} job(s) em failed. Veja a bull-board.\n`);
	}

	await queue.close();
	await connection.quit();
	process.exit(drained ? 0 : 1);
}

main().catch((err) => {
	console.error(`\n  ERRO: ${err.message}\n`);
	process.exit(1);
});
