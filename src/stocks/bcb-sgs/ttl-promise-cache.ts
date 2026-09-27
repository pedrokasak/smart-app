/**
 * Cache em memória de resultados assíncronos com TTL e teto de entradas.
 *
 * Chamadas concorrentes para a mesma chave compartilham a mesma promessa, então
 * um pico de requisições do dashboard vira uma única ida à origem. Falhas não
 * são cacheadas: a próxima chamada tenta de novo.
 */
export class TtlPromiseCache<T> {
	private readonly entries = new Map<
		string,
		{ expiresAt: number; value: Promise<T> }
	>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
		private readonly now: () => number = Date.now
	) {}

	getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
		const cached = this.entries.get(key);
		if (cached && cached.expiresAt > this.now()) return cached.value;
		if (cached) this.entries.delete(key);

		const value = load();
		this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value });
		this.evictOverflow();

		value.catch(() => {
			// Só remove se ainda for a mesma promessa (outra carga pode ter
			// entrado depois da expiração).
			if (this.entries.get(key)?.value === value) this.entries.delete(key);
		});
		return value;
	}

	private evictOverflow(): void {
		// Map preserva ordem de inserção: a primeira chave é a mais antiga.
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) return;
			this.entries.delete(oldest);
		}
	}
}
