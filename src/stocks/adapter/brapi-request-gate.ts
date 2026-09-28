/**
 * Fila única para toda chamada HTTP à brapi (TRA-247).
 *
 * O plano grátis responde `x-brapi-concurrency-limit: 1`: uma segunda
 * requisição em voo volta 429 ("Limite de requisições simultâneas
 * atingido"). A varredura de cotações e as telas disparavam em paralelo
 * (`Promise.all`), então quase tudo além da primeira chamada falhava e caía
 * em fallbacks que também estão limitados.
 *
 * Um semáforo por processo resolve na origem: as chamadas esperam a vez em
 * vez de falhar. `BRAPI_MAX_CONCURRENCY` sobe o limite quando o plano pago
 * permitir. Um 429 ainda pode chegar (outro processo, limite mensal); nesse
 * caso a chamada é repetida algumas vezes com espera crescente.
 */

const RETRY_DELAYS_MS = [800, 2_000];

function maxConcurrency(): number {
	const parsed = Number(process.env.BRAPI_MAX_CONCURRENCY);
	return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

let active = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
	if (active < maxConcurrency()) {
		active += 1;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
	const next = waiting.shift();
	// A vaga passa direto para quem espera: `active` não muda.
	if (next) next();
	else active = Math.max(0, active - 1);
}

export function isBrapiRateLimit(error: unknown): boolean {
	return (
		(error as { response?: { status?: number } })?.response?.status === 429
	);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executa `task` respeitando a concorrência da brapi e repetindo em 429. */
export async function brapiRequest<T>(
	task: () => Promise<T>,
	options: { retryDelaysMs?: number[] } = {}
): Promise<T> {
	const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
	await acquire();
	try {
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await task();
			} catch (error) {
				if (!isBrapiRateLimit(error) || attempt >= delays.length) throw error;
				await sleep(delays[attempt]);
			}
		}
	} finally {
		release();
	}
}

/** Só para testes: estado da fila. */
export function brapiGateState() {
	return { active, waiting: waiting.length };
}
