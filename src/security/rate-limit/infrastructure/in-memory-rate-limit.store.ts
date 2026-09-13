import { Injectable } from '@nestjs/common';
import {
	RateLimitHit,
	RateLimitStore,
} from 'src/security/rate-limit/application/ports/rate-limit-store.port';

type RateBucket = {
	count: number;
	resetAt: number;
};

/**
 * Contador em memoria do processo (TRA-138).
 *
 * E o comportamento que o middleware tinha antes desta issue, extraido para
 * tras da porta. Continua sendo o certo em dois cenarios:
 *
 *   - teste: nao exige um Redis de verdade no CI;
 *   - desenvolvimento local e deploy de instancia unica sem Redis.
 *
 * NAO serve com mais de uma instancia: cada processo conta o seu proprio
 * balde e o limite efetivo vira `limite x instancias`. Esse e exatamente o
 * motivo da TRA-138 e do RedisRateLimitStore.
 */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
	private readonly buckets = new Map<string, RateBucket>();
	private readonly cleanupIntervalMs = 60_000;

	/**
	 * Teto de baldes ativos. Existe pra que uma enxurrada de fingerprints
	 * distintos nao vire consumo de memoria sem limite entre duas passadas da
	 * limpeza — o `cleanup` so remove o que ja expirou.
	 */
	private readonly maxBuckets = 50_000;
	private cleanupTimer: NodeJS.Timeout | null = null;

	hit(key: string, windowMs: number): Promise<RateLimitHit> {
		this.ensureCleanupTimer();

		const now = Date.now();
		const existing = this.buckets.get(key);

		if (!existing || existing.resetAt <= now) {
			if (this.buckets.size >= this.maxBuckets) {
				this.cleanup();
			}
			this.buckets.set(key, { count: 1, resetAt: now + windowMs });
			return Promise.resolve({
				outcome: 'counted',
				count: 1,
				resetInMs: windowMs,
			});
		}

		existing.count += 1;

		return Promise.resolve({
			outcome: 'counted',
			count: existing.count,
			resetInMs: existing.resetAt - now,
		});
	}

	private ensureCleanupTimer(): void {
		if (this.cleanupTimer) return;
		this.cleanupTimer = setInterval(
			() => this.cleanup(),
			this.cleanupIntervalMs
		);
		// Sem `unref` o timer sozinho segura o event loop e o processo nao
		// encerra (nem o Jest).
		this.cleanupTimer.unref();
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, bucket] of this.buckets.entries()) {
			if (bucket.resetAt <= now) {
				this.buckets.delete(key);
			}
		}
	}
}
