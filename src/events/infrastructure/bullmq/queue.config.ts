import z from 'zod';

/**
 * Configuracao da fila duravel (TRA-136, fase 2).
 *
 * Schema proprio, separado de `src/env.ts`, porque nenhuma destas variaveis
 * e obrigatoria: sem Redis o servidor sobe igual e o barramento continua
 * funcionando in-process. `src/env.ts` derruba o processo quando falta uma
 * variavel — comportamento certo para JWT_SECRET, errado para isto.
 *
 * ---------------------------------------------------------------------
 * Dimensionamento dos defaults (~5 mil usuarios drenando o burst do cron)
 * ---------------------------------------------------------------------
 * O cron diario acorda e publica ate ~5.000 eventos de uma vez. Cada job e
 * IO-bound (Mongo + Resend/FCM + eventualmente uma chamada ao trackerr-ia),
 * estimado em ~200ms de espera e quase nenhuma CPU.
 *
 *   concorrencia 20  ->  20 / 0,2s  = ~100 jobs/s por instancia
 *   5.000 jobs / 100 = ~50s para drenar o burst inteiro
 *
 * 20 e escolhido por ser IO-bound: o event loop fica ocioso esperando rede,
 * entao subir a concorrencia nao briga por CPU. O teto real nao e o Node, e
 * o provedor de e-mail — por isso existe o rate limit abaixo, calibrado
 * fora do burst diario e ajustavel por env sem deploy de codigo. Com mais
 * de uma instancia a vazao soma, porque o BullMQ divide os jobs entre elas.
 *
 * Retry: 5 tentativas com backoff exponencial de base 5s (5s, 10s, 20s,
 * 40s) cobre a janela tipica de indisponibilidade de um provedor SaaS sem
 * segurar um job por horas. Esgotadas, o envelope vai para a dead-letter.
 */

/**
 * Ausente = ligado. So 'false'/'0'/'no'/'off' desligam — evita que um typo
 * no valor da variavel desligue a fila silenciosamente.
 */
function isNotDisabled(value: string | undefined): boolean {
	if (value === undefined) return true;
	return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

const configSchema = z.object({
	REDIS_HOST: z.string().default('localhost'),
	REDIS_PORT: z.coerce.number().int().positive().default(6379),
	REDIS_PASSWORD: z.string().optional(),
	REDIS_DB: z.coerce.number().int().min(0).default(0),

	/**
	 * Desliga a fila por completo (nenhuma conexao e aberta). Default: ligada
	 * fora de teste. Em teste, ligar exigiria um Redis de verdade no CI.
	 */
	EVENTS_QUEUE_ENABLED: z.string().optional().transform(isNotDisabled),

	/**
	 * Permite subir instancias que so publicam (API) e instancias que so
	 * consomem (worker), sem mudar codigo.
	 */
	EVENTS_QUEUE_WORKER_ENABLED: z.string().optional().transform(isNotDisabled),

	EVENTS_QUEUE_NAME: z.string().default('trackerr.events'),
	EVENTS_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(20),
	EVENTS_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).default(5),
	EVENTS_QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(5000),

	/**
	 * Teto de jobs iniciados por janela. Protege o provedor de e-mail/push do
	 * burst do cron. 200 jobs / 1s deixa folga sobre os ~100 jobs/s que a
	 * concorrencia entrega — existe como freio de emergencia ajustavel, nao
	 * como gargalo do dia a dia.
	 */
	EVENTS_QUEUE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),
	EVENTS_QUEUE_RATE_LIMIT_WINDOW_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(1000),

	/**
	 * Retencao dos jobs concluidos. Tambem define a JANELA DE DEDUPLICACAO:
	 * o `jobId` so bloqueia um reenvio enquanto o job existir no Redis. 24h
	 * bate de proposito com DEDUPE_WINDOW_HOURS do NotificationsService.
	 */
	EVENTS_QUEUE_KEEP_COMPLETED_SECONDS: z.coerce
		.number()
		.int()
		.positive()
		.default(24 * 60 * 60),
	EVENTS_QUEUE_KEEP_COMPLETED_COUNT: z.coerce
		.number()
		.int()
		.positive()
		.default(5000),
	/** Falhas ficam 7 dias: e o material da investigacao post-mortem. */
	EVENTS_QUEUE_KEEP_FAILED_SECONDS: z.coerce
		.number()
		.int()
		.positive()
		.default(7 * 24 * 60 * 60),

	/**
	 * Teto de espera do enfileiramento. Com o Redis inacessivel mas sem
	 * recusar a conexao (rede particionada, por exemplo), o comando ficaria
	 * pendurado e seguraria o request que publicou o evento. Dois segundos e
	 * mais que suficiente para um Redis no mesmo host do Coolify.
	 */
	EVENTS_QUEUE_ENQUEUE_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(2000),
});

export interface EventQueueConfig {
	enabled: boolean;
	workerEnabled: boolean;
	queueName: string;
	deadLetterQueueName: string;
	connection: {
		host: string;
		port: number;
		password?: string;
		db: number;
	};
	concurrency: number;
	attempts: number;
	backoffMs: number;
	rateLimit: { max: number; durationMs: number };
	keepCompletedSeconds: number;
	keepCompletedCount: number;
	keepFailedSeconds: number;
	enqueueTimeoutMs: number;
}

export const EVENT_QUEUE_CONFIG = Symbol('EVENT_QUEUE_CONFIG');

export function loadEventQueueConfig(
	source: NodeJS.ProcessEnv = process.env
): EventQueueConfig {
	const parsed = configSchema.safeParse(source);

	if (!parsed.success) {
		// Config invalida nao pode derrubar a API: cai para a fila desligada,
		// o barramento in-process continua e o operador ve o motivo no log.
		throw new InvalidEventQueueConfigError(
			JSON.stringify(parsed.error.flatten().fieldErrors)
		);
	}

	const c = parsed.data;
	const isTest = source.NODE_ENV === 'test';

	return {
		enabled: c.EVENTS_QUEUE_ENABLED && !isTest,
		workerEnabled: c.EVENTS_QUEUE_WORKER_ENABLED && !isTest,
		queueName: c.EVENTS_QUEUE_NAME,
		deadLetterQueueName: `${c.EVENTS_QUEUE_NAME}.dead-letter`,
		connection: {
			host: c.REDIS_HOST,
			port: c.REDIS_PORT,
			...(c.REDIS_PASSWORD ? { password: c.REDIS_PASSWORD } : {}),
			db: c.REDIS_DB,
		},
		concurrency: c.EVENTS_QUEUE_CONCURRENCY,
		attempts: c.EVENTS_QUEUE_ATTEMPTS,
		backoffMs: c.EVENTS_QUEUE_BACKOFF_MS,
		rateLimit: {
			max: c.EVENTS_QUEUE_RATE_LIMIT_MAX,
			durationMs: c.EVENTS_QUEUE_RATE_LIMIT_WINDOW_MS,
		},
		keepCompletedSeconds: c.EVENTS_QUEUE_KEEP_COMPLETED_SECONDS,
		keepCompletedCount: c.EVENTS_QUEUE_KEEP_COMPLETED_COUNT,
		keepFailedSeconds: c.EVENTS_QUEUE_KEEP_FAILED_SECONDS,
		enqueueTimeoutMs: c.EVENTS_QUEUE_ENQUEUE_TIMEOUT_MS,
	};
}

export class InvalidEventQueueConfigError extends Error {
	constructor(detail: string) {
		super(`Configuracao invalida da fila de eventos: ${detail}`);
		this.name = 'InvalidEventQueueConfigError';
	}
}
